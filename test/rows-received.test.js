/* Harness: catch a truncated upload via the printer's 0xD3 row-received counter.
 *
 * No dependencies, no runner: `node test/rows-received.test.js`. Exits non-zero on
 * failure. NO PRINTER IS INVOLVED — everything below is a fake characteristic.
 *
 * What this protects (docs/TASKS.md T-038): the driver's characteristic failure is a
 * label that comes out short or blank while progress reports 100%, because unacked BLE
 * writes are dropped silently. A D11_H page sent "paced" truncated even though PageEnd
 * (0xE4) was acked — the printer still volunteers, unasked, a 0xD3 notification naming
 * the last row it actually received (docs/NOTES.md, "0xD3 is a row-received counter").
 * This harness proves the driver now compares that count against the page height instead
 * of discarding it into `lastUnsolicited`.
 *
 * The no-0xD3-seen case is as important as the rejection: most models never emit 0xD3,
 * and a model that stays silent must NOT start failing (workspace rule: distinguish
 * FAILED from COULD NOT VERIFY).
 *
 * `globalThis.navigator` MUST exist before src/niimbot.js loads (see CLAUDE.md).
 */
"use strict";
const assert = require("node:assert/strict");

Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: {
    platform: "Win32",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    bluetooth: { requestDevice: async () => device },
  },
});

// ── Fake GATT ────────────────────────────────────────────────────────────────
let notify = null;
const writes = [];              // every command byte written, in order
let pageCounter = 0;            // what the fake printer reports as printed
let d3Queue = [];                // row indices (0-based) to emit as 0xD3 right before each PageEnd ack

function frame(cmd, data) {
  const pkt = new Uint8Array(7 + data.length);
  pkt[0] = 0x55; pkt[1] = 0x55; pkt[2] = cmd; pkt[3] = data.length;
  let crc = cmd ^ data.length;
  for (let i = 0; i < data.length; i++) { pkt[4 + i] = data[i]; crc ^= data[i]; }
  pkt[4 + data.length] = crc & 0xff;
  pkt[5 + data.length] = 0xaa; pkt[6 + data.length] = 0xaa;
  return new DataView(pkt.buffer);
}
// Pushes a notification through the SAME dispatcher the driver's own printer traffic
// uses (onNotify, reached via the characteristic's "characteristicvaluechanged"
// listener) — not a shortcut into the driver's internals.
const answer = (cmd, data) => notify && notify({ target: { value: frame(cmd, data) } });

function handle(bytes) {
  if (bytes[0] === 0x03) return;             // raw connect packet, not a framed command
  const cmd = bytes[2];
  writes.push(cmd);
  switch (cmd) {
    case 0xc1: break;                                  // connect
    case 0xa5:                                         // PrinterStatusData (detectPrinter)
      answer(0xb5, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 0]);
      break;
    case 0x40: answer(0x48, [0x10, 0x01]); break;      // PrinterModelId → model 4097 (B1 Pro)
    case 0x21: answer(0x31, [0x01]); break;            // SetDensity
    case 0x23: answer(0x33, [0x01]); break;            // SetLabelType
    case 0x01: answer(0x02, [0x01]); break;            // PrintStart
    case 0x13: answer(0x14, [0x01, 0x00]); break;      // SetPageSize
    case 0xe3:                                         // PageEnd
      pageCounter++;
      // The real printer volunteers 0xD3 unasked, sometime around row upload / PageEnd —
      // emitting it here, synchronously before the 0xE4 ack, is enough to land it in
      // the driver's tracker before sendPagePacked reads it (same event-loop turn).
      for (const rowIdx of d3Queue) answer(0xd3, [(rowIdx >> 8) & 0xff, rowIdx & 0xff, 0x01]);
      answer(0xe4, [0x01]);
      break;
    case 0xf3: answer(0xf4, [0x01]); break;            // PrintEnd
    case 0xa3:                                         // PrintStatus
      answer(0xb3, [0x00, pageCounter, 0x64, 0x00, 0x00, 0x00, 0x00, 0x01, 0, 0, 0]);
      break;
    default: break;                                    // image rows etc.
  }
}

const characteristic = {
  properties: { write: true, writeWithoutResponse: true },
  async startNotifications() {},
  addEventListener(_e, fn) { notify = fn; },
  async writeValueWithoutResponse(buf) { handle(new Uint8Array(buf)); },
  async writeValue(buf) { handle(new Uint8Array(buf)); },
};
const gatt = {
  connected: false,
  async connect() { this.connected = true; return { getPrimaryService: async () => ({ getCharacteristic: async () => characteristic }) }; },
  disconnect() { this.connected = false; },
};
const device = { name: "B1-TEST", gatt, addEventListener() {} };

require("../src/niimbot.js");
const Niimbot = globalThis.Niimbot;
Niimbot.PAGE_WAIT_MS = 300;      // a 25 s test is a test nobody runs

// A 2×2 PNG, so imageToPacked has something real to rasterize.
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR42mNkYPhfz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC";
const MODEL = { name_prefixes: ["B1"], task: "v4", density: 3, label_type: 1, speed: 1 };
const SIZE = { w_px: 16, h_px: 260 };   // 260 rows, matching the D11_H measurement (199/259)

globalThis.fetch = async () => ({ blob: async () => ({}) });
globalThis.createImageBitmap = async () => ({ width: 2, height: 2 });
globalThis.document = {
  createElement: () => ({
    width: 0, height: 0,
    getContext: () => ({
      fillStyle: "", fillRect() {}, drawImage() {},
      getImageData(_x, _y, w, h) { return { data: new Uint8ClampedArray(w * h * 4).fill(255) }; },
    }),
  }),
};

let failures = 0;
async function ok(name, fn) {
  try { await fn(); console.log("ok  " + name); }
  catch (e) { failures++; console.error("FAIL " + name + "\n     " + (e && e.stack)); }
}

function reset({ d3 = [] } = {}) {
  writes.length = 0; pageCounter = 0; d3Queue = d3;
  gatt.connected = false;
}
const sent = (cmd) => writes.indexOf(cmd);

(async () => {
  // ── (a) 0xD3 confirms the full page (last index = h-1) ─────────────────────
  await ok("(a) 0xD3 = 259 on a 260-row page resolves normally", async () => {
    reset({ d3: [259] });
    await Niimbot.printImage(PNG, { model: MODEL, size: SIZE });
    assert.ok(sent(0xf3) >= 0, "PrintEnd must still be sent on the happy path");
  });

  // ── (b) 0xD3 proves rows were lost ───────────────────────────────────────────
  await ok("(b) 0xD3 = 199 on a 260-row page REJECTS naming 199 and 259", async () => {
    reset({ d3: [199] });
    let err = null;
    try { await Niimbot.printImage(PNG, { model: MODEL, size: SIZE }); }
    catch (e) { err = e; }
    assert.ok(err, "a page that lost rows must not resolve as success");
    assert.match(err.message, /199/, "the message must name the row actually received: " + err.message);
    assert.match(err.message, /259/, "the message must name the row the page needed: " + err.message);
  });

  // ── (c) Several 0xD3 in one page: the MAX wins, not the last ────────────────
  await ok("(c) 199 then 259 resolves — the max is what counts", async () => {
    reset({ d3: [199, 259] });
    await Niimbot.printImage(PNG, { model: MODEL, size: SIZE });
    assert.ok(sent(0xf3) >= 0);
  });

  await ok("(c2) 259 then 199 (out of order) still resolves — order must not matter", async () => {
    reset({ d3: [259, 199] });
    await Niimbot.printImage(PNG, { model: MODEL, size: SIZE });
    assert.ok(sent(0xf3) >= 0);
  });

  // ── (d) No 0xD3 at all: "could not verify" must NOT become "failed" ────────
  await ok("(d) no 0xD3 seen resolves without throwing (silent models must not break)", async () => {
    reset({ d3: [] });
    await Niimbot.printImage(PNG, { model: MODEL, size: SIZE });
    assert.ok(sent(0xf3) >= 0, "PrintEnd must still be sent when nothing was there to check");
  });

  // ── (e) On rejection, PrintEnd (0xF3) went out BEFORE the throw ─────────────
  await ok("(e) a row-loss rejection still sends PrintEnd first", async () => {
    reset({ d3: [199] });
    let err = null;
    try { await Niimbot.printImage(PNG, { model: MODEL, size: SIZE }); }
    catch (e) { err = e; }
    assert.ok(err, "must reject");
    const end = sent(0xf3);
    assert.ok(end >= 0, "PrintEnd MUST still be sent so the paper feeds out");
    assert.equal(end, writes.length - 1, "PrintEnd must be the final write, i.e. sent before the throw");
  });

  // ── printBatch goes through the same path ────────────────────────────────────
  await ok("(f) printBatch also rejects a page whose 0xD3 proves rows were lost", async () => {
    reset({ d3: [199] });
    let err = null;
    try { await Niimbot.printBatch([PNG], { model: MODEL, size: SIZE }); }
    catch (e) { err = e; }
    assert.ok(err, "printBatch must reject too — it shares sendPagePacked");
    assert.match(err.message, /199/);
    assert.match(err.message, /259/);
    assert.equal(sent(0xf3), writes.length - 1, "PrintEnd must be the final write");
  });

  // ── PAGE_PIPELINE explicitly skips the check (T-038 item 4) ─────────────────
  await ok("(g) PAGE_PIPELINE skips the 0xD3 check — a lossy page still resolves", async () => {
    reset({ d3: [199] });
    Niimbot.PAGE_PIPELINE = true;
    let err = null;
    try { await Niimbot.printBatch([PNG], { model: MODEL, size: SIZE }); }
    catch (e) { err = e; }
    Niimbot.PAGE_PIPELINE = false;   // restore for any test that runs after this one
    assert.equal(err, null, "PAGE_PIPELINE must not attribute a 0xD3 check to the wrong page — see T-038 item 4: " + (err && err.message));
  });

  console.log(failures
    ? `\nFAILED — ${failures} case(s).`
    : "\nPASS — a page whose 0xD3 counter proves it lost rows now rejects, naming both\n"
      + "       numbers, with PrintEnd sent first; a model that never emits 0xD3 is left\n"
      + "       alone; PAGE_PIPELINE skips the check rather than risk blaming the wrong\n"
      + "       page. NO PRINTER RAN THIS.");
  process.exit(failures ? 1 : 0);
})();
