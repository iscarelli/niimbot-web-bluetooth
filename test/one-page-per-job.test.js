/* Harness: `pagesPerJob: 1` — the D110 acks a multi-page/multi-copy job but only ever
 * prints the first page (measured 2026-08-14: 3 copies in one job prints ONE label and
 * the page counter parks at 1 until PAGE_WAIT_MS gives up; a 3-page batch is refused
 * mid-stream with an undocumented `0xdb 06`). Three SEPARATE jobs print all three,
 * clean. This harness checks that printImage/printBatch fall back to N separate jobs
 * on that model, and — the assertion that matters most — that every OTHER model still
 * gets exactly ONE job for N copies/pages.
 *
 * No dependencies, no runner: `node test/one-page-per-job.test.js`. Exits non-zero on
 * failure. NO PRINTER IS INVOLVED — everything below is a fake characteristic. Nothing
 * here proves the D110 actually prints 3 of 3 through the new path — only that the
 * driver now EMITS 3 separate jobs instead of 1. Hardware confirmation of that is the
 * maintainer's separate step.
 *
 * `globalThis.navigator` MUST exist before src/niimbot.js loads (see CLAUDE.md).
 *
 * ── The trap this file exists to avoid (see docs/TASKS.md T-008) ────────────────────
 * A sibling harness (test/unconfirmed.test.js) answers PrinterInfo (0x40[08]) with
 * opcode 0x4f, which the driver does NOT treat as an identification response — it
 * waits for 0x48 (src/niimbot.js detectPrinter()). That harness gets away with it
 * because it passes an explicit `model` and never checks which branch fired. THIS
 * harness needs the driver to actually IDENTIFY the connected printer (modelId must
 * end up 2304 or 4097, matching MODEL_IDS), because pagesPerJob is keyed off
 * `printerInfo.modelId`, not off the caller's `model` argument. So PrinterInfo here
 * is answered with opcode 0x48, carrying the model id big-endian: [0x09,0x00] = 2304
 * (D110), [0x10,0x01] = 4097 (B1 Pro). Confirmed below (assertion 0) that this
 * actually identifies before trusting any of the per-model assertions that follow.
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
let pageCounter = 0;            // what the fake printer reports as printed THIS job
let lastCopies = 1;             // copies declared by the last SetPageSize (0x13)
let identifyId = null;          // [hi, lo] — what PrinterInfo (0x40[08]) answers with

const D110_ID = [0x09, 0x00];   // 2304
const B1PRO_ID = [0x10, 0x01];  // 4097

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
  if (bytes[0] === 0x03) return;               // raw connect packet — not a framed command
  const cmd = bytes[2];
  const sub = bytes[4];                        // first data byte, where 0x40 subcommands live
  writes.push(cmd);
  payloads.push({ cmd, data: Array.from(bytes.slice(4, 4 + bytes[3])) });
  switch (cmd) {
    case 0xc1: break;                                     // connect
    case 0xa5: {                                          // PrinterStatusData → proto 4
      const d = new Array(13).fill(0); d[11] = 3; d[12] = 0;
      answer(0xb5, d);
      break;
    }
    case 0x40:
      if (sub === 0x08) answer(0x48, identifyId);         // PrinterModelId — MUST be 0x48, not 0x4f
      else answer(0x49, [0x00]);                          // b1Handshake info reads accept any response cmd
      break;
    case 0xdc: answer(0xd9, [0x00]); break;                // Heartbeat
    case 0x21: answer(0x31, [0x01]); break;                // SetDensity
    case 0x23: answer(0x33, [0x01]); break;                // SetLabelType
    case 0x01:                                              // PrintStart — the printer's page
      pageCounter = 0; lastCopies = 1;                       // counter resets to 0 at the start of
      answer(0x02, [0x01]);                                  // EACH job (measured, see docs/TASKS.md T-008)
      break;
    case 0x03: answer(0x04, [0x01]); break;                // PageStart (b1 task only)
    case 0x13:                                             // SetPageSize — copies live at
      lastCopies = ((bytes[8] << 8) | bytes[9]) || 1;       // data[4..5] = bytes[8..9] (4-byte header)
      answer(0x14, [0x01, 0x00]);
      break;
    // PageEnd: a SINGLE PageEnd is what a real printer sees for a page uploaded once
    // with copies=N — it then reprints that page N times internally, and its own page
    // counter (what 0xa3→0xb3 reports) climbs by N for that one PageEnd, not by 1. So
    // the fake must advance by `lastCopies`, or printImage({copies:3}) can never reach
    // its target here — which would fail assertion (c) for a reason that has nothing
    // to do with pagesPerJob.
    case 0xe3: pageCounter += lastCopies; answer(0xe4, [0x01]); break;
    case 0xf3: answer(0xf4, [0x01]); break;                // PrintEnd
    case 0xa3:                                             // PrintStatus
      answer(0xb3, [(pageCounter >> 8) & 0xff, pageCounter & 0xff, 0x64, 0, 0, 0, 0, 0, 0, 0, 0]);
      break;
    default: break;                                        // image rows etc.
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
const device = { name: "TEST", gatt, addEventListener() {} };

require("../src/niimbot.js");
const Niimbot = globalThis.Niimbot;
Niimbot.PAGE_WAIT_MS = 300;     // a 25 s test is a test nobody runs

// A 2×2 PNG, so imageToPacked has something real to rasterize.
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR42mNkYPhfz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC";
// task must match what the fake printer identifies as, or assertSelection() throws.
const D110_MODEL = { name_prefixes: ["D110"], task: "b1", density: 3, label_type: 1, speed: 1 };
const B1PRO_MODEL = { name_prefixes: ["B1"], task: "v4", density: 3, label_type: 1, speed: 1 };
const SIZE = { w_px: 16, h_px: 2 };

// Stub exactly what imageToPacked needs (src/niimbot.js): fetch → blob → createImageBitmap
// → drawImage → getImageData. Pixels come back all-white — this harness measures the JOB
// SPLITTING, not the encoder (test/pacing.test.js covers the write path).
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
  catch (e) { failures++; console.error("FAIL " + name + "\n     " + (e && e.stack ? e.stack : e)); }
}

function reset(id) {
  writes.length = 0; payloads.length = 0; pageCounter = 0; lastCopies = 1;
  identifyId = id;
  gatt.connected = false;   // forces connect() to redo the full handshake, including identify
}
const countCmd = (cmd) => writes.filter((c) => c === cmd).length;
const payloadsFor = (cmd) => payloads.filter((p) => p.cmd === cmd);
const u16 = (d, i) => (d[i] << 8) | d[i + 1];

(async () => {
  // ── (0) Sanity: the fake printer actually identifies — the trap this file exists
  //       to avoid. If this fails, every assertion below is meaningless (it would be
  //       exercising the "unidentified printer" fallback, not pagesPerJob).
  await ok("(0) the harness's PrinterInfo answer (0x48) actually identifies the D110", async () => {
    reset(D110_ID);
    await Niimbot.identify(D110_MODEL);
    assert.equal(Niimbot.printer && Niimbot.printer.modelId, 2304,
      `expected modelId 2304 after identify, got ${Niimbot.printer && Niimbot.printer.modelId} — ` +
      `if this is null, the fake printer answered with the wrong opcode (must be 0x48, not 0x4f)`);
    await Niimbot.disconnect();
  });

  await ok("(0b) …and the B1 Pro", async () => {
    reset(B1PRO_ID);
    await Niimbot.identify(B1PRO_MODEL);
    assert.equal(Niimbot.printer && Niimbot.printer.modelId, 4097);
    await Niimbot.disconnect();
  });

  // ── (a) D110, printImage(copies:3): three separate jobs ────────────────────
  await ok("(a) D110 printImage({copies:3}) emits THREE PrintStart(pages=1)/PrintEnd, never SetPageSize copies>1", async () => {
    reset(D110_ID);
    await Niimbot.printImage(PNG, { model: D110_MODEL, size: SIZE, copies: 3 });
    assert.equal(countCmd(0x01), 3, `expected 3 PrintStart, saw ${countCmd(0x01)}`);
    assert.equal(countCmd(0xf3), 3, `expected 3 PrintEnd, saw ${countCmd(0xf3)}`);
    for (const p of payloadsFor(0x01)) {
      assert.equal(u16(p.data, 0), 1, `every PrintStart must declare pages=1, saw ${u16(p.data, 0)}`);
    }
    for (const p of payloadsFor(0x13)) {
      assert.equal(u16(p.data, 4), 1, `no SetPageSize may carry copies>1, saw ${u16(p.data, 4)}`);
    }
  });

  // ── (b) D110, printBatch: also three separate jobs ──────────────────────────
  await ok("(b) D110 printBatch([3 urls]) also emits three separate jobs", async () => {
    reset(D110_ID);
    await Niimbot.printBatch([PNG, PNG, PNG], { model: D110_MODEL, size: SIZE });
    assert.equal(countCmd(0x01), 3, `expected 3 PrintStart, saw ${countCmd(0x01)}`);
    assert.equal(countCmd(0xf3), 3, `expected 3 PrintEnd, saw ${countCmd(0xf3)}`);
    for (const p of payloadsFor(0x01)) {
      assert.equal(u16(p.data, 0), 1, `every PrintStart must declare pages=1, saw ${u16(p.data, 0)}`);
    }
  });

  // ── (c) REGRESSION — the assertion that matters most. The B1 Pro has no
  //       pagesPerJob entry and MUST keep behaving exactly as before: one job,
  //       N pages/copies declared once. If this fails, this change broke the B1
  //       Pro the way v1.3.3 did. ─────────────────────────────────────────────
  await ok("(c) REGRESSION: B1 Pro printImage({copies:3}) still emits ONE job (pages=3, copies=3)", async () => {
    reset(B1PRO_ID);
    await Niimbot.printImage(PNG, { model: B1PRO_MODEL, size: SIZE, copies: 3 });
    assert.equal(countCmd(0x01), 1, `expected exactly 1 PrintStart, saw ${countCmd(0x01)}`);
    assert.equal(countCmd(0xf3), 1, `expected exactly 1 PrintEnd, saw ${countCmd(0xf3)}`);
    assert.equal(countCmd(0x13), 1, `expected exactly 1 SetPageSize, saw ${countCmd(0x13)}`);
    assert.equal(u16(payloadsFor(0x01)[0].data, 0), 3, "PrintStart must declare pages=3");
    assert.equal(u16(payloadsFor(0x13)[0].data, 4), 3, "SetPageSize must declare copies=3");
  });

  console.log(failures
    ? `\nFAILED — ${failures} case(s).`
    : "\nPASS — the D110 (pagesPerJob:1) now gets N separate jobs for N copies/pages, and\n"
      + "       the B1 Pro is UNCHANGED (one job, pages=N, copies=N). NO PRINTER RAN THIS:\n"
      + "       it proves the driver emits the right number of jobs, not that the D110\n"
      + "       actually prints 3 of 3 through this path — that is hardware confirmation,\n"
      + "       the maintainer's separate step.");
  process.exit(failures ? 1 : 0);
})();
