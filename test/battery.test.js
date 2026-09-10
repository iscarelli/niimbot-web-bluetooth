/* Harness: Niimbot.battery() — does the battery reporter read chargeLevel per the
 * CONNECTED model's batteryScale, and refuse to guess when the raw byte contradicts
 * that scale rather than silently coercing it into a plausible-looking number?
 *
 * No dependencies, no runner: `node test/battery.test.js`. Exits non-zero on failure.
 * NO PRINTER IS INVOLVED IN RUNNING THIS. The B1 Pro chargeLevel readings documented
 * at MODEL_IDS (src/niimbot.js — 0x50/0x28 across captures, matching 0x40[0x0a]) are
 * what motivated `batteryScale: "percent"` there; this harness only feeds synthetic
 * heartbeat bytes through the same decode path
 * (decodeHeartbeat -> Niimbot.getStatus -> Niimbot.battery) — it does not talk to
 * hardware and proves nothing about a real printer's reading.
 *
 * `globalThis.navigator` MUST exist before src/niimbot.js loads: IS_MAC reads
 * navigator.platform at load time (see CLAUDE.md). Node >= 21 already defines a
 * `navigator` global as a getter-only property, so it takes defineProperty to
 * replace it — a plain assignment throws.
 */
"use strict";
const assert = require("node:assert/strict");

// ── Browser globals, installed BEFORE the driver loads ───────────────────────
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: {
    platform: "Win32",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    bluetooth: { requestDevice: async () => device },
  },
});

// ── Fake GATT ────────────────────────────────────────────────────────────────
let notify = null;                 // the driver's characteristicvaluechanged listener

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

// What the fake answers to 0xDC (heartbeat). `null` = stay silent.
let reply = { heartbeat: null };
// The model id the fake reports: 4097 = B1 Pro (batteryScale "percent"),
// 4096 = B1 (batteryScale "enum"). Sent big-endian, as the printer does.
let modelId = 4097;

function handle(bytes) {
  if (bytes.length < 7 || bytes[0] !== 0x55 || bytes[1] !== 0x55) return;  // e.g. the 0x03 connect packet
  const cmd = bytes[2], sub = bytes[4];
  if (cmd === 0xa5) {                          // PrinterStatusData → protocol 5
    const d = new Array(13).fill(0); d[11] = 3; d[12] = 5;
    deliver(0xb5, d);
  } else if (cmd === 0x40 && sub === 0x08) {   // PrinterModelId
    deliver(0x48, [(modelId >> 8) & 0xff, modelId & 0xff]);
  } else if (cmd === 0x40) {
    deliver(0x40 + sub, [0x00]);               // info reads: keep the handshake from timing out
  } else if (cmd === 0xdc) {                   // Heartbeat
    if (reply.heartbeat) deliver(reply.heartbeat.cmd, reply.heartbeat.data);
  }
  // 0x1A (RfidInfo) is left unanswered on purpose — battery() never touches rfid.
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
const device = { name: "TEST", gatt, addEventListener() {} };

// ── Load the driver (attaches globalThis.Niimbot) ────────────────────────────
require("../src/niimbot.js");
const Niimbot = globalThis.Niimbot;
const MODEL = { name_prefixes: ["X"], task: "v4" };

// Keep RFID waits out of this file's runtime — battery() doesn't use rfid anyway.
const FAST = { rfidTimeoutMs: 40 };

// A minimal advanced2/13 heartbeat with only chargeLevel (idx2) set to the value
// under test; every other field is inert zeros this file doesn't assert on.
const hbWithCharge = (charge) => {
  const d = new Array(13).fill(0);
  d[2] = charge;
  return d;
};

(async () => {
  // ── B1 Pro (4097): batteryScale "percent" ───────────────────────────────────
  await Niimbot.connect(MODEL);
  assert.equal(Niimbot.printer.modelId, 4097, "fake printer should identify as B1 Pro");

  reply = { heartbeat: { cmd: 0xd9, data: hbWithCharge(40) } };
  let st = await Niimbot.getStatus(FAST);
  let bat = Niimbot.battery(st);
  assert.deepEqual(bat, { raw: 40, scale: "percent", percent: 40, text: "40%", evidence: "inferred" },
    "percent scale: raw 40 reads as 40%");
  console.log("ok  (p1) percent 40 -> 40%");

  reply = { heartbeat: { cmd: 0xd9, data: hbWithCharge(200) } };
  st = await Niimbot.getStatus(FAST);
  bat = Niimbot.battery(st);
  assert.equal(bat.scale, "unknown", "percent scale: raw > 100 is a contradiction, not a value to trust");
  assert.equal(bat.percent, null, "a contradiction must not report a percent");
  assert.equal(bat.raw, 200, "raw survives even when the scale contradicts it");
  assert.match(bat.text, /unknown/i, "text must say unknown, not guess a percent");
  console.log("ok  (p2) percent scale, raw 200 -> unknown, percent null");

  // ── B1 (4096): batteryScale "enum" ──────────────────────────────────────────
  await Niimbot.disconnect();
  modelId = 4096;
  await Niimbot.connect(MODEL);
  assert.equal(Niimbot.printer.modelId, 4096, "fake printer should now identify as a B1");

  reply = { heartbeat: { cmd: 0xd9, data: hbWithCharge(4) } };
  st = await Niimbot.getStatus(FAST);
  bat = Niimbot.battery(st);
  assert.deepEqual(bat, { raw: 4, scale: "enum", percent: 100, text: "100% (level 4 of 4)", evidence: "inferred" },
    "enum scale: raw 4 (top of 0-4) reads as 100%");
  console.log("ok  (e1) enum 4 -> 100%");

  reply = { heartbeat: { cmd: 0xd9, data: hbWithCharge(0) } };
  st = await Niimbot.getStatus(FAST);
  bat = Niimbot.battery(st);
  assert.deepEqual(bat, { raw: 0, scale: "enum", percent: 0, text: "0% (level 0 of 4)", evidence: "inferred" },
    "enum scale: raw 0 reads as 0%");
  console.log("ok  (e2) enum 0 -> 0%");

  reply = { heartbeat: { cmd: 0xd9, data: hbWithCharge(40) } };
  st = await Niimbot.getStatus(FAST);
  bat = Niimbot.battery(st);
  assert.equal(bat.scale, "unknown", "enum scale: raw 40 is far outside 0-4 — a contradiction, not a level to round");
  assert.equal(bat.percent, null, "a contradiction must not report a percent");
  assert.equal(bat.raw, 40, "raw survives even when the scale contradicts it");
  assert.match(bat.text, /unknown/i, "text must say unknown, not guess a level");
  console.log("ok  (e3) enum scale, raw 40 -> unknown, percent null");

  // ── No heartbeat decoded → null, never a fake zero ──────────────────────────
  assert.equal(Niimbot.battery({ decoded: null }), null, "no decoded status -> battery() must return null");
  assert.equal(Niimbot.battery(null), null, "no status at all -> battery() must return null");
  reply = { heartbeat: null };
  st = await Niimbot.getStatus({ timeoutMs: 40, rfidTimeoutMs: 40 });
  assert.equal(st.decoded, null, "a silent heartbeat must decode to null (sanity check on the fixture)");
  assert.equal(Niimbot.battery(st), null, "a status with no decoded heartbeat -> battery() must return null");
  console.log("ok  (n) no heartbeat decoded -> null, never a fake 0");

  // battery() must never be called from inside the driver — same guardrail
  // test/status.test.js already applies to getStatus()/readiness(): a reporter that
  // acquires a caller inside the driver has become a gate.
  const src = require("node:fs").readFileSync(require("node:path").join(__dirname, "../src/niimbot.js"), "utf8");
  const uncalled = (name) => src.split("\n").filter((l) =>
    new RegExp(`${name}\\s*\\(`).test(l) &&              // a mention with a paren…
    !new RegExp(`function\\s+${name}\\s*\\(`).test(l) && // …that is not its own definition…
    !/^\s*(\/\/|\*)/.test(l));                           // …and not a comment about it.
  const callers = uncalled("battery");
  assert.equal(callers.length, 0, `no code in the driver may CALL battery(); found: ${callers.join(" | ")}`);

  await Niimbot.disconnect();
  console.log("PASS — battery() reads chargeLevel per the connected model's scale, and refuses");
  console.log("       to guess when the raw byte contradicts it. NO PRINTER RAN THIS TEST.");
  process.exit(0);
})().catch((e) => { console.error("FAIL —", e && e.message ? e.message : e); process.exit(1); });
