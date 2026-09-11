/* Harness: Niimbot.BUNDLE — the runtime override for per-model frame bundling (T-037).
 *
 * The D11_H sends one BLE write per row frame (`bundle: false`), and a 208-frame page
 * cuts short on paper while shorter pages come out whole — but bundling could not be
 * TESTED on it before this: `_bundleAllowed` was decided at connect from MODEL_IDS with
 * no public override. This harness proves the override actually changes how many BLE
 * writes go out, in both directions, and only when asked.
 *
 * No dependencies, no runner: `node test/bundle.test.js`. Exits non-zero on failure.
 * NO PRINTER IS INVOLVED — this counts writeValueWithoutResponse calls and their sizes
 * against a fake GATT characteristic. It says nothing about whether a real label comes
 * out; that is the maintainer's step, on hardware, looking at paper.
 *
 * `globalThis.navigator` MUST exist before src/niimbot.js loads (see CLAUDE.md).
 */
"use strict";
const assert = require("node:assert/strict");

// ── Browser globals, installed BEFORE the driver loads ───────────────────────
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: {
    platform: "Win32",                                 // not a Mac → no forced pacing
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    bluetooth: { requestDevice: async () => device },
  },
});

// ── A page with many DISTINCT rows: a checkerboard, so no two adjacent rows are
// equal and sendImage's run-length merge never fires — every row becomes its own
// 0x84/0x85 frame, which is what makes bundling (or not) visible in the write count.
// Every row also has both black and white pixels, so every frame is 0x85 (never the
// shorter empty-row 0x84), keeping every frame the same byte length.
globalThis.fetch = async () => ({ blob: async () => ({}) });
globalThis.createImageBitmap = async () => ({ width: W, height: H });
globalThis.document = {
  createElement: () => ({
    width: 0, height: 0,
    getContext: () => ({
      fillStyle: "", fillRect() {}, drawImage() {},
      getImageData(_x, _y, w, h) {
        const data = new Uint8ClampedArray(w * h * 4);
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            const v = (x + y) % 2 === 0 ? 0 : 255;   // checkerboard
            data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255;
          }
        }
        return { data };
      },
    }),
  }),
};

const W = 64, H = 120;   // stride = 8 → every 0x85 frame is 13+8 = 21 bytes
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR42mNkYPhfz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC";
const SIZE = { w_px: W, h_px: H };

// ── Fake GATT: identifies as whichever model id is set, answers the b1/v4 job
// lifecycle, and records every image-row write (cmd 0x84/0x85) with its byte length —
// bundled or not, the row frame(s) always start the write, so filtering by the first
// frame's cmd correctly counts both cases. ─────────────────────────────────────────
let notify = null;
let identifyId = null;      // [hi, lo] — what PrinterInfo (0x40[08]) answers with
let pageCounter = 0;
let imageWrites = [];       // byte length of each write whose first frame is 0x84/0x85

const B1PRO_ID = [0x10, 0x01];   // 4097 — bundle:false
const B1_ID = [0x10, 0x00];      // 4096 — bundle:true

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
  if (bytes[0] === 0x03) return;                // raw connect packet, not a framed command
  const cmd = bytes[2];
  const sub = bytes[4];
  switch (cmd) {
    case 0xa5: { const d = new Array(13).fill(0); d[11] = 3; d[12] = 0; answer(0xb5, d); break; }
    case 0x40:
      if (sub === 0x08) answer(0x48, identifyId);          // PrinterModelId
      else answer(0x49, [0x00]);                            // b1Handshake info reads accept any response
      break;
    case 0xdc: answer(0xd9, [0x00]); break;                 // Heartbeat (b1Handshake)
    case 0x21: answer(0x31, [0x01]); break;                 // SetDensity
    case 0x23: answer(0x33, [0x01]); break;                 // SetLabelType
    case 0x01: pageCounter = 0; answer(0x02, [0x01]); break; // PrintStart
    case 0x03: answer(0x04, [0x01]); break;                 // PageStart (b1 task only)
    case 0x13: answer(0x14, [0x01, 0x00]); break;           // SetPageSize (6b or 13b, either task)
    case 0xe3: pageCounter += 1; answer(0xe4, [0x01]); break; // PageEnd
    case 0xf3: answer(0xf4, [0x01]); break;                 // PrintEnd
    case 0xa3: answer(0xb3, [(pageCounter >> 8) & 0xff, pageCounter & 0xff, 0x64, 0, 0, 0, 0, 0, 0, 0, 0]); break; // PrintStatus
    default: break;                                         // image rows (0x84/0x85) need no ack
  }
}

const characteristic = {
  properties: { write: true, writeWithoutResponse: true },
  async startNotifications() {},
  addEventListener(type, fn) { if (type === "characteristicvaluechanged") notify = fn; },
  async writeValueWithoutResponse(bytes) {
    if (bytes.length >= 3 && bytes[0] === 0x55 && bytes[1] === 0x55 && (bytes[2] === 0x84 || bytes[2] === 0x85)) {
      imageWrites.push(bytes.length);
    }
    handle(bytes);
  },
  async writeValueWithResponse(bytes) { handle(bytes); },
};
const gatt = {
  connected: false,
  async connect() { this.connected = true; return { getPrimaryService: async () => ({ getCharacteristic: async () => characteristic }) }; },
  disconnect() { this.connected = false; },
};
const device = { name: "TEST", gatt, addEventListener() {} };

require("../src/niimbot.js");
const Niimbot = globalThis.Niimbot;
Niimbot.PAGE_WAIT_MS = 300;   // the fake answers synchronously; no reason to sit through the real default
Niimbot.PACE_MS = 0;          // irrelevant to what this harness measures (write COUNT/size, not timing)

const B1PRO_MODEL = { name_prefixes: ["B1"], task: "v4", density: 3, label_type: 1, speed: 1 };
const B1_MODEL = { name_prefixes: ["B1"], task: "b1", density: 3, label_type: 1 };

async function freshConnect(id) {
  gatt.connected = false;
  identifyId = id;
  const logs = [];
  const realLog = console.log;
  console.log = (...a) => { logs.push(a.join(" ")); };
  Niimbot.DEBUG = false;
  const model = id === B1_ID ? B1_MODEL : B1PRO_MODEL;
  try { await Niimbot.connect(model); } finally { console.log = realLog; }
  return logs;
}

async function printAndCount(model) {
  imageWrites = [];
  await Niimbot.printImage(PNG, { model, size: SIZE });
  return imageWrites.slice();
}

(async () => {
  assert.equal(Niimbot.BUNDLE, null, "BUNDLE must default to null (auto)");

  // ── (a) B1 Pro (bundle:false), BUNDLE=null → one write per frame ────────────
  await freshConnect(B1PRO_ID);
  assert.equal(Niimbot.DETECTED_BUNDLE, false, "the B1 Pro must detect bundle:false");
  assert.equal(Niimbot.EFFECTIVE_BUNDLE, false, "auto on a non-bundling model must stay false");
  const a = await printAndCount(B1PRO_MODEL);
  console.log(`(a) B1 Pro, BUNDLE=null:  ${a.length} writes for ${H} rows`);
  assert.equal(a.length, H, `auto on bundle:false must write one frame per write, expected ${H}, got ${a.length}`);
  assert.ok(a.every((n) => n === 21), "every unbundled row write must be exactly one 21-byte frame");

  // ── (b) same connection, BUNDLE=true → strictly fewer writes, none over BUNDLE_MAX ──
  Niimbot.BUNDLE = true;
  assert.equal(Niimbot.DETECTED_BUNDLE, false, "DETECTED_BUNDLE must still report the model's real default");
  assert.equal(Niimbot.EFFECTIVE_BUNDLE, true, "EFFECTIVE_BUNDLE must follow the override");
  assert.notEqual(Niimbot.DETECTED_BUNDLE, Niimbot.EFFECTIVE_BUNDLE, "(e) DETECTED_BUNDLE and EFFECTIVE_BUNDLE must diverge with the override forcing true over a false default");
  const b = await printAndCount(B1PRO_MODEL);
  console.log(`(b) B1 Pro, BUNDLE=true:  ${b.length} writes for ${H} rows`);
  assert.ok(b.length < a.length, `BUNDLE=true must cut the write count below (a)'s ${a.length}, got ${b.length}`);
  assert.ok(b.every((n) => n <= Niimbot.BUNDLE_MAX), `no bundled write may exceed BUNDLE_MAX (${Niimbot.BUNDLE_MAX}), saw up to ${Math.max(...b)}`);
  Niimbot.BUNDLE = null;   // back to auto before the next model
  await Niimbot.disconnect();

  // ── (c) B1 (bundle:true), BUNDLE=false → forced back to one write per frame ─
  const cLogs = await freshConnect(B1_ID);
  assert.ok(
    cLogs.some((l) => /bundle=true \(detected=true\)/.test(l)),
    "connect line must report bundle=<effective> (detected=<model default>) — got:\n" + cLogs.join("\n")
  );
  assert.equal(Niimbot.DETECTED_BUNDLE, true, "the B1 must detect bundle:true");
  assert.equal(Niimbot.EFFECTIVE_BUNDLE, true, "with no override yet, effective must equal detected");
  const setLogs = [];
  const realLog2 = console.log;
  console.log = (...a) => { setLogs.push(a.join(" ")); };
  Niimbot.BUNDLE = false;
  console.log = realLog2;
  assert.ok(
    setLogs.some((l) => /BUNDLE override = false.*effective=false.*detected=true/.test(l)),
    "setting BUNDLE must log the override, effective and detected values — got:\n" + setLogs.join("\n")
  );
  assert.equal(Niimbot.DETECTED_BUNDLE, true, "DETECTED_BUNDLE must still report the model's real default");
  assert.equal(Niimbot.EFFECTIVE_BUNDLE, false, "EFFECTIVE_BUNDLE must follow the override");
  assert.notEqual(Niimbot.DETECTED_BUNDLE, Niimbot.EFFECTIVE_BUNDLE, "(e) DETECTED_BUNDLE and EFFECTIVE_BUNDLE must diverge with the override forcing false over a true default");
  const c = await printAndCount(B1_MODEL);
  console.log(`(c) B1,     BUNDLE=false: ${c.length} writes for ${H} rows`);
  assert.equal(c.length, H, `BUNDLE=false on bundle:true must write one frame per write, expected ${H}, got ${c.length}`);
  assert.ok(c.every((n) => n === 21), "every forced-unbundled row write must be exactly one 21-byte frame");
  Niimbot.BUNDLE = null;
  await Niimbot.disconnect();

  // ── (d) an invalid value throws TypeError, and does not touch the override ──
  Niimbot.BUNDLE = true;
  for (const bad of ["sim", "true", 1, 0, "auto", {}, []]) {
    assert.throws(
      () => { Niimbot.BUNDLE = bad; },
      (e) => e instanceof TypeError && /Niimbot\.BUNDLE must be null, true, or false/.test(e.message),
      `BUNDLE = ${JSON.stringify(bad)} must throw a TypeError naming the three accepted values`
    );
  }
  assert.equal(Niimbot.BUNDLE, true, "a rejected value must leave the previous override intact");
  Niimbot.BUNDLE = null;

  console.log("PASS — BUNDLE verified: auto respects the per-model default (a), forcing true cuts");
  console.log("       the write count without exceeding BUNDLE_MAX (b), forcing false overrides a");
  console.log("       bundling model back to one frame per write (c), an invalid value throws");
  console.log("       TypeError without touching the override (d), and DETECTED_BUNDLE/");
  console.log("       EFFECTIVE_BUNDLE diverge exactly when the override disagrees with the model (e).");
  console.log("       NO PRINTER INVOLVED: this counts BLE writes and their sizes against a fake");
  console.log("       characteristic, not ink on paper.");
  process.exit(0);
})().catch((e) => { console.error("FAIL —", e && e.stack ? e.stack : e); process.exit(1); });
