/* Harness: a job the printer never confirmed must NOT resolve as success.
 *
 * No dependencies, no runner: `node test/unconfirmed.test.js`. Exits non-zero on
 * failure. NO PRINTER IS INVOLVED — everything below is a fake characteristic.
 *
 * What this protects, measured on real hardware 2026-08-13: a 5-label batch printed
 * FOUR labels, the page counter never passed 4, the PageEnd for one page went unacked,
 * and the driver logged "all 5 pages printed" and resolved "ok". Two independent silent
 * failures produced that — waitPage returning identically whether it succeeded or timed
 * out, and the PageEnd ack being discarded.
 *
 * The assertions on ORDER matter as much as the ones on rejection: "PrintEnd was sent"
 * and "PrintEnd was sent BEFORE the throw" are different claims, and only the second
 * means the paper was fed out rather than left under the printhead.
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
const payloads = [];            // { cmd, data } for the commands whose data matters
let pageCounter = 0;            // what the fake printer reports as printed
let ackPageEnd = true;          // whether 0xE3 is answered with 0xE4
let advanceOnPageEnd = true;    // whether the counter moves when a page is buffered

function frame(cmd, data) {
  const pkt = new Uint8Array(7 + data.length);
  pkt[0] = 0x55; pkt[1] = 0x55; pkt[2] = cmd; pkt[3] = data.length;
  let crc = cmd ^ data.length;
  for (let i = 0; i < data.length; i++) { pkt[4 + i] = data[i]; crc ^= data[i]; }
  pkt[4 + data.length] = crc & 0xff;
  pkt[5 + data.length] = 0xaa; pkt[6 + data.length] = 0xaa;
  return new DataView(pkt.buffer);
}
const answer = (cmd, data) => notify && notify({ target: { value: frame(cmd, data) } });

function handle(bytes) {
  // Raw connect packet (0x03 prefix) — not a framed command.
  if (bytes[0] === 0x03) return;
  const cmd = bytes[2];
  writes.push(cmd);
  payloads.push({ cmd, data: Array.from(bytes.slice(4, 4 + bytes[3])) });
  switch (cmd) {
    case 0xc1: break;                                  // connect
    case 0x40: answer(0x4f, [0x10, 0x01]); break;      // PrinterInfo → model 4097 (B1 Pro)
    case 0x21: answer(0x31, [0x01]); break;            // SetDensity
    case 0x23: answer(0x33, [0x01]); break;            // SetLabelType
    case 0x01: answer(0x02, [0x01]); break;            // PrintStart
    case 0x13: answer(0x14, [0x01, 0x00]); break;      // SetPageSize
    case 0xe3:                                         // PageEnd
      if (advanceOnPageEnd) pageCounter++;
      if (ackPageEnd) answer(0xe4, [0x01]);
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
const SIZE = { w_px: 16, h_px: 2 };

// The driver rasterizes on a <canvas>: fetch → blob → createImageBitmap → drawImage →
// getImageData (src/niimbot.js:632-646). Node has none of that, so stub exactly those
// four. The pixels come back all-white, which is fine — this harness measures the
// CONFIRMATION protocol, not the encoder (test/pacing.test.js covers the write path).
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
  catch (e) { failures++; console.error("FAIL " + name + "\n     " + (e && e.message)); }
}

function reset({ ack = true, advance = true } = {}) {
  writes.length = 0; payloads.length = 0; pageCounter = 0; ackPageEnd = ack; advanceOnPageEnd = advance;
  gatt.connected = false;
}
const sent = (cmd) => writes.indexOf(cmd);

(async () => {
  // ── (c) The happy path still resolves ──────────────────────────────────────
  await ok("(c) a confirmed batch resolves and sends PrintEnd", async () => {
    reset();
    await Niimbot.printBatch([PNG, PNG], { model: MODEL, size: SIZE });
    assert.ok(sent(0xf3) >= 0, "PrintEnd must be sent on the happy path");
    assert.equal(pageCounter, 2, "both pages should have been counted");
  });

  await ok("(c2) a confirmed single image resolves", async () => {
    reset();
    await Niimbot.printImage(PNG, { model: MODEL, size: SIZE });
    assert.ok(sent(0xf3) >= 0);
  });

  // ── (dens) density: validated before the printer is touched, then sent ────
  await ok("(dens) a valid density reaches the printer as SetDensity", async () => {
    reset();
    await Niimbot.printImage(PNG, { model: MODEL, size: SIZE, density: 5 });
    const set = payloads.find((p) => p.cmd === 0x21);
    assert.ok(set, "SetDensity (0x21) must be sent");
    assert.deepEqual(set.data, [5], "the caller's density, not the model's default of 3");
  });

  await ok("(dens2) a string density works — an HTML <select> yields strings", async () => {
    reset();
    await Niimbot.printImage(PNG, { model: MODEL, size: SIZE, density: "4" });
    assert.deepEqual(payloads.find((p) => p.cmd === 0x21).data, [4]);
  });

  await ok("(dens3) omitting it falls back to the model", async () => {
    reset();
    await Niimbot.printImage(PNG, { model: MODEL, size: SIZE });
    assert.deepEqual(payloads.find((p) => p.cmd === 0x21).data, [MODEL.density]);
  });

  await ok("(dens4) an out-of-range density is refused BEFORE anything is written", async () => {
    for (const bad of [0, 6, 3.5, NaN, -1]) {
      reset();
      let err = null;
      try { await Niimbot.printBatch([PNG], { model: MODEL, size: SIZE, density: bad }); }
      catch (e) { err = e; }
      assert.ok(err, `density ${bad} must be refused`);
      assert.match(err.message, /density must be an integer/);
      // This is the point: the printhead controls how hard it burns, so a bad value
      // must not reach a connected printer half-way through job setup.
      assert.equal(writes.length, 0, `density ${bad}: nothing may be written to the printer`);
    }
  });

  // ── (a) The counter never reaches the target ───────────────────────────────
  await ok("(a) a stalled page counter REJECTS, after PrintEnd, naming the numbers", async () => {
    reset({ advance: false });                      // pages ack, but nothing ever prints
    let err = null;
    try { await Niimbot.printBatch([PNG, PNG, PNG], { model: MODEL, size: SIZE }); }
    catch (e) { err = e; }
    assert.ok(err, "a job whose counter never moved must not resolve");
    assert.match(err.message, /not confirmed/i);
    assert.match(err.message, /page 0 of \d/, "the message must say where it stalled: " + err.message);
    assert.match(err.message, /PrintEnd was sent/, "and that the paper was fed out");
    const end = sent(0xf3);
    assert.ok(end >= 0, "PrintEnd MUST still be sent when the job fails");
    // Order: PrintEnd is the last thing written, i.e. it went out before the throw.
    assert.equal(end, writes.length - 1, "PrintEnd must be the final write, so the paper is fed out before failing");
  });

  // ── (b) PageEnd never acknowledged ─────────────────────────────────────────
  await ok("(b) an unacked PageEnd REJECTS, after PrintEnd, naming the page", async () => {
    reset({ ack: false });
    let err = null;
    try { await Niimbot.printBatch([PNG, PNG, PNG], { model: MODEL, size: SIZE }); }
    catch (e) { err = e; }
    assert.ok(err, "an unacknowledged page must not resolve as success");
    assert.match(err.message, /page 1 of 3/, "the message must name the page: " + err.message);
    const end = sent(0xf3);
    assert.ok(end >= 0, "PrintEnd MUST still be sent");
    assert.equal(end, writes.length - 1, "PrintEnd must be the final write");
  });

  await ok("(b2) printImage rejects on an unacked PageEnd, PrintEnd still sent", async () => {
    reset({ ack: false });
    let err = null;
    try { await Niimbot.printImage(PNG, { model: MODEL, size: SIZE }); }
    catch (e) { err = e; }
    assert.ok(err, "printImage must reject too — it had the same defect");
    assert.match(err.message, /not confirmed/i);
    assert.equal(sent(0xf3), writes.length - 1, "PrintEnd must be the final write");
  });

  // ── (d) A failure stops the loop instead of streaming the rest ─────────────
  await ok("(d) an unacked page stops the batch instead of sending the remaining pages", async () => {
    reset({ ack: false });
    try { await Niimbot.printBatch([PNG, PNG, PNG, PNG, PNG], { model: MODEL, size: SIZE }); } catch (e) {}
    const pageEnds = writes.filter((c) => c === 0xe3).length;
    assert.equal(pageEnds, 1, `only the first page should have been sent, saw ${pageEnds} PageEnds`);
  });

  console.log(failures
    ? `\nFAILED — ${failures} case(s).`
    : "\nPASS — an unconfirmed job now rejects, names what stalled, and still sends\n"
      + "       PrintEnd FIRST so the paper is fed out. NO PRINTER RAN THIS: it proves\n"
      + "       the driver stopped lying, not that any print path works.");
  process.exit(failures ? 1 : 0);
})();
