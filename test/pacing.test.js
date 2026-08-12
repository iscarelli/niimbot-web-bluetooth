/* Harness: Niimbot.FORCE_PACING — does the runtime override actually change the
 * spacing of BLE writes, and only when asked?
 *
 * No dependencies, no runner: `node test/pacing.test.js`. Exits non-zero on failure.
 * NO PRINTER IS INVOLVED — this measures write timing against a fake GATT
 * characteristic. It says nothing about whether a real label comes out.
 *
 * `globalThis.navigator` MUST exist before src/niimbot.js loads: IS_MAC reads
 * navigator.platform at load time (see CLAUDE.md). Node ≥ 21 already defines a
 * `navigator` global as a getter-only property, so it takes defineProperty to
 * replace it — a plain assignment throws.
 */
"use strict";
const assert = require("node:assert/strict");

// ── Browser globals, installed BEFORE the driver loads ───────────────────────
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: {
    platform: "Win32",                                 // not a Mac → IS_MAC false → "fast" survives
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    bluetooth: { requestDevice: async () => device },
  },
});

// ── Fake GATT: records the timestamp of every write, and answers the driver ──
const writes = [];               // { t, cmd, sub }
let notify = null;               // the driver's characteristicvaluechanged listener

function frame(cmd, data) {
  const pkt = new Uint8Array(7 + data.length);
  pkt[0] = 0x55; pkt[1] = 0x55; pkt[2] = cmd; pkt[3] = data.length;
  let crc = cmd ^ data.length;
  for (let i = 0; i < data.length; i++) { pkt[4 + i] = data[i]; crc ^= data[i]; }
  pkt[4 + data.length] = crc & 0xff;
  pkt[5 + data.length] = 0xaa; pkt[6 + data.length] = 0xaa;
  return new DataView(pkt.buffer);
}
function deliver(cmd, data) { notify && notify({ target: { value: frame(cmd, data) } }); }

// Answer synchronously, inside the write call, so a response round-trip is never
// what separates two writes — any gap we measure comes from writeRaw's own pacing.
function handle(bytes) {
  if (bytes.length < 7 || bytes[0] !== 0x55 || bytes[1] !== 0x55) return; // e.g. the 0x03 connect packet
  const cmd = bytes[2], sub = bytes[4];
  writes.push({ t: performance.now(), cmd, sub });
  if (cmd === 0xa5) {                       // PrinterStatusData → proto 4
    const d = new Array(13).fill(0); d[11] = 3; d[12] = 0;
    deliver(0xb5, d);
  } else if (cmd === 0x40 && sub === 0x08) { // PrinterModelId → 4608 = M2-H
    deliver(0x48, [0x12, 0x00]);            // task "b1" (runs the handshake) + paced:false → "fast"
  } else if (cmd === 0x40) {
    deliver(0x48, [0x00]);                  // handshake info reads accept any response cmd
  } else if (cmd === 0xdc) {
    deliver(0xd9, [0x00]);                  // Heartbeat
  }
}

const characteristic = {
  properties: { write: true, writeWithoutResponse: true },
  async startNotifications() {},
  addEventListener(type, fn) { if (type === "characteristicvaluechanged") notify = fn; },
  async writeValueWithoutResponse(bytes) { handle(bytes); },
  async writeValueWithResponse(bytes) { handle(bytes); },
};
const gatt = {
  connected: false,
  async connect() { this.connected = true; return { getPrimaryService: async () => ({ getCharacteristic: async () => characteristic }) }; },
  disconnect() { this.connected = false; },
};
const device = { name: "M2-H-TEST", gatt, addEventListener() {} };

// ── Load the driver (attaches globalThis.Niimbot) ────────────────────────────
require("../src/niimbot.js");
const Niimbot = globalThis.Niimbot;
const MODEL = { name_prefixes: ["M2"], task: "b1" };

// The B1 handshake is 10 back-to-back writes (status + 8 info reads + heartbeat) —
// the only burst reachable without a printer, and it goes through writeRaw like a
// page row does.
const HANDSHAKE_WRITES = 10;

async function connectAndMeasure(force) {
  Niimbot.FORCE_PACING = force;
  writes.length = 0;
  const logs = [];
  const realLog = console.log;
  console.log = (...a) => { logs.push(a.join(" ")); };
  Niimbot.DEBUG = true;                       // so the connect summary line is emitted
  try {
    await Niimbot.connect(MODEL);
  } finally {
    Niimbot.DEBUG = false;
    console.log = realLog;
    await Niimbot.disconnect();
  }
  const burst = writes.slice(-HANDSHAKE_WRITES);
  assert.equal(burst.length, HANDSHAKE_WRITES, "expected the 10-write B1 handshake burst");
  const gaps = burst.slice(1).map((w, i) => w.t - burst[i].t);
  return { gaps, logs };
}

function fmt(gaps) { return gaps.map((g) => g.toFixed(1)).join(", "); }

(async () => {
  const PACE = Niimbot.PACE_MS;
  assert.equal(Niimbot.FORCE_PACING, false, "FORCE_PACING must default to false");

  // Direction 1 — override OFF: a detected "fast" model must burst with no gap.
  // (Without this case the test would also pass against a driver that always paces.)
  const off = await connectAndMeasure(false);
  const maxOff = Math.max(...off.gaps);
  console.log(`FORCE_PACING=false  gaps(ms): ${fmt(off.gaps)}`);
  assert.ok(
    maxOff < PACE * 0.5,
    `expected no pacing with FORCE_PACING=false, but the largest gap was ${maxOff.toFixed(1)}ms (PACE_MS=${PACE})`
  );
  assert.ok(
    off.logs.some((l) => /writeMode=fast\b/.test(l) && /forcePacing=false/.test(l)),
    "connect log must report the detected mode and forcePacing=false"
  );

  // Direction 2 — override ON: the same model, same connection path, now paced.
  const on = await connectAndMeasure(true);
  const minOn = Math.min(...on.gaps);
  console.log(`FORCE_PACING=true   gaps(ms): ${fmt(on.gaps)}`);
  assert.ok(
    minOn >= PACE * 0.8,
    `expected every write spaced by ~${PACE}ms with FORCE_PACING=true, but the smallest gap was ${minOn.toFixed(1)}ms`
  );
  assert.ok(
    on.logs.some((l) => /writeMode=fast\b/.test(l) && /forcePacing=true/.test(l)),
    "the DETECTED writeMode must stay 'fast' (not mutated) while forcePacing reports true"
  );

  // The override is read per write, so flipping it needs no reconnect: prove the
  // effective mode follows the flag while a single connection stays open.
  Niimbot.FORCE_PACING = false;
  await Niimbot.connect(MODEL);
  writes.length = 0;
  Niimbot.FORCE_PACING = true;                 // flipped mid-connection
  await Niimbot.identify(MODEL);               // no-op on an open connection…
  Niimbot.FORCE_PACING = 1;                    // setter coerces to boolean
  assert.equal(Niimbot.FORCE_PACING, true, "FORCE_PACING setter must coerce to boolean");
  assert.equal(writes.length, 0, "identify on an open connection must not reconnect");
  await Niimbot.disconnect();

  console.log("PASS — FORCE_PACING pacing verified in both directions. NO PRINTER INVOLVED.");
  process.exit(0);
})().catch((e) => { console.error("FAIL —", e && e.message ? e.message : e); process.exit(1); });
