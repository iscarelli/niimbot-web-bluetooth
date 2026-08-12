/* Harness: Niimbot.getStatus() — does the consumable-status decode hold its promise
 * that `raw` is exact and `decoded` never guesses?
 *
 * No dependencies, no runner: `node test/status.test.js`. Exits non-zero on failure.
 * NO PRINTER IS INVOLVED. Every response here is bytes this file made up, shaped to
 * niimbluelib's documented layouts — so a PASS proves the DECODER matches the layouts
 * we transcribed, NOT that a real printer sends those layouts. That is still open (see
 * docs/protocol-v4.md § Consumable status).
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

// What the fake answers to 0xDC / 0x1A for the case under test. `null` = stay silent,
// which is how the driver's timeout paths get exercised.
let reply = { heartbeat: null, rfid: null };

// Answered synchronously inside the write, exactly as in pacing.test.js.
function handle(bytes) {
  if (bytes.length < 7 || bytes[0] !== 0x55 || bytes[1] !== 0x55) return;  // 0x03 connect packet
  const cmd = bytes[2], sub = bytes[4];
  if (cmd === 0xa5) {                          // PrinterStatusData → protocol 5
    const d = new Array(13).fill(0); d[11] = 3; d[12] = 5;
    deliver(0xb5, d);
  } else if (cmd === 0x40 && sub === 0x08) {   // PrinterModelId → 4097 = B1 Pro
    deliver(0x48, [0x10, 0x01]);               // task "v4" → connect runs NO handshake
  } else if (cmd === 0x40) {
    deliver(0x48, [0x00]);
  } else if (cmd === 0xdc) {                   // Heartbeat
    if (reply.heartbeat) deliver(reply.heartbeat.cmd, reply.heartbeat.data);
  } else if (cmd === 0x1a) {                   // RfidInfo
    if (reply.rfid) deliver(0x1b, reply.rfid);
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
const device = { name: "B1-TEST", gatt, addEventListener() {} };

// ── Load the driver (attaches globalThis.Niimbot) ────────────────────────────
require("../src/niimbot.js");
const Niimbot = globalThis.Niimbot;
const MODEL = { name_prefixes: ["B1"], task: "v4" };

// Keep the silent-RFID cases quick: the default 600 ms wait is the driver's, not the
// test's, and it is asserted separately below.
const FAST = { rfidTimeoutMs: 40 };

const bytes = (u8) => Array.from(u8 || []);

(async () => {
  // ── (d) Not connected → a clear throw, and no auto-connect ─────────────────
  await assert.rejects(
    () => Niimbot.getStatus(),
    (e) => /not connected/i.test(e.message),
    "getStatus() must throw a clear not-connected error before connecting"
  );
  assert.equal(gatt.connected, false, "getStatus() must never connect on its own");

  await Niimbot.connect(MODEL);
  assert.equal(Niimbot.printer.modelId, 4097, "fake printer should identify as B1 Pro");

  // ── (a) A layout we decode: Advanced2 (0xD9), 9 bytes ──────────────────────
  // [_, _, charge, temp, lid, paper, paperRfid, ribbonRfid, ribbon]
  //  0 = lid closed, 0 = paper inserted, non-0 = RFID read ok (niimbluelib polarity).
  const HB = [0x00, 0x00, 0x03, 0x19, 0x00, 0x00, 0x01, 0x00, 0x01];
  // uuid(8) · barCode "AB" · serial "S1" · allPaper 100 · usedPaper 3 · type 1
  const RFID = [1, 2, 3, 4, 5, 6, 7, 8, 2, 0x41, 0x42, 2, 0x53, 0x31, 0x00, 0x64, 0x00, 0x03, 0x01];
  reply = { heartbeat: { cmd: 0xd9, data: HB }, rfid: RFID };
  let st = await Niimbot.getStatus(FAST);

  assert.deepEqual(bytes(st.raw.heartbeat), HB, "raw.heartbeat must be the exact bytes the printer sent");
  assert.equal(st.raw.heartbeatCmd, 0xd9, "raw must record the response opcode (it selects the layout)");
  assert.deepEqual(bytes(st.raw.rfid), RFID, "raw.rfid must be the exact bytes the printer sent");
  assert.equal(st.confidence, "inferred", "a decoded status is 'inferred', never 'validated'");
  assert.deepEqual(st.decoded.heartbeat, {
    layout: "advanced2/9",
    chargeLevel: 3, temp: 0x19,
    lidClosed: true, paperInserted: true, paperRfidSuccess: true,
    ribbonRfidSuccess: false, ribbonInserted: false,
  }, "Advanced2 heartbeat fields");
  assert.deepEqual(st.decoded.rfid, {
    tagPresent: true, uuid: "0102030405060708", barCode: "AB", serialNumber: "S1",
    allPaper: 100, usedPaper: 3, consumablesType: 1,
  }, "RfidInfo fields");
  console.log("ok  (a) known layout decoded, raw exact");

  // Same bytes, opposite polarity, so the booleans are read and not hardcoded.
  reply.heartbeat = { cmd: 0xd9, data: [0, 0, 4, 0x1a, 0x01, 0x01, 0x00, 0x01, 0x00] };
  st = await Niimbot.getStatus(FAST);
  assert.deepEqual(
    { l: st.decoded.heartbeat.lidClosed, p: st.decoded.heartbeat.paperInserted, r: st.decoded.heartbeat.paperRfidSuccess, ri: st.decoded.heartbeat.ribbonInserted },
    { l: false, p: false, r: false, ri: true },
    "heartbeat booleans must follow the bytes"
  );

  // ── (b) A length we do NOT know → decoded null, confidence unknown ─────────
  const SHORT = [0xde, 0xad, 0xbe, 0xef, 0x01];        // Advanced2 needs ≥ 9 bytes
  reply = { heartbeat: { cmd: 0xd9, data: SHORT }, rfid: null };
  st = await Niimbot.getStatus(FAST);
  assert.deepEqual(bytes(st.raw.heartbeat), SHORT, "an undecodable payload must still be returned verbatim");
  assert.equal(st.decoded, null, "an unrecognised layout must yield decoded === null, not a half-filled object");
  assert.equal(st.confidence, "unknown", "an unrecognised layout must report confidence 'unknown'");
  assert.equal(st.raw.rfid, null);
  console.log("ok  (b) unknown layout refused (decoded null / confidence unknown)");

  // An unknown Advanced1 length is refused the same way (10/13/19/20 are the known ones).
  reply = { heartbeat: { cmd: 0xdd, data: new Array(11).fill(0) }, rfid: null };
  st = await Niimbot.getStatus(FAST);
  assert.equal(st.decoded, null, "Advanced1 with an unlisted length must not be decoded");
  // …while a listed one is. 13 bytes: lid@9, charge@10, paper@11, paperRfid@12.
  const A1 = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0x00, 0x02, 0x00, 0x01];
  reply = { heartbeat: { cmd: 0xdd, data: A1 }, rfid: null };
  st = await Niimbot.getStatus(FAST);
  assert.deepEqual(st.decoded.heartbeat, {
    layout: "advanced1/13", lidClosed: true, chargeLevel: 2, paperInserted: true, paperRfidSuccess: true,
  }, "Advanced1 13-byte layout");
  // A heartbeat variant niimbluelib decodes no fields from (Basic 0xDE) is not guessed.
  reply = { heartbeat: { cmd: 0xde, data: [0x01] }, rfid: null };
  st = await Niimbot.getStatus(FAST);
  assert.equal(st.decoded, null, "a Basic (0xDE) heartbeat carries no decodable fields");
  assert.equal(st.raw.heartbeatCmd, 0xde);
  console.log("ok  (b') Advanced1 lengths + undecodable opcode handled");

  // ── (c) No 0x1B answer at all → resolves with rfid null, does not throw ────
  reply = { heartbeat: { cmd: 0xd9, data: HB }, rfid: null };
  st = await Niimbot.getStatus(FAST);
  assert.equal(st.raw.rfid, null, "a silent RFID must be null, not an error");
  assert.equal(st.decoded.rfid, null, "a silent RFID must decode to null");
  assert.ok(st.decoded.heartbeat, "a silent RFID must not lose the heartbeat");
  assert.equal(st.confidence, "inferred");
  console.log("ok  (c) missing RFID answer is normal, not an error");

  // The default RFID wait is short (~600 ms) so this stays a pause, never a hang.
  const t0 = Date.now();
  st = await Niimbot.getStatus();
  const waited = Date.now() - t0;
  assert.ok(waited < 1500, `default silent-RFID wait should be ~600ms, took ${waited}ms`);
  console.log(`ok  (c') default silent-RFID wait ${waited}ms`);

  // ── RFID payload shapes ────────────────────────────────────────────────────
  reply.rfid = [0x00];                                   // 1 byte = no tag
  st = await Niimbot.getStatus(FAST);
  assert.deepEqual(st.decoded.rfid, { tagPresent: false }, "a 1-byte 0x1B means no tag");

  reply.rfid = RFID.concat([0x00, 0x50]);                // + capacity 80
  st = await Niimbot.getStatus(FAST);
  assert.equal(st.decoded.rfid.capacity, 80, "the optional capacity field");

  reply.rfid = RFID.concat([0x07]);                      // one leftover byte
  st = await Niimbot.getStatus(FAST);
  assert.equal(st.decoded.rfid, null, "leftover bytes mean it is not this layout → refuse");
  assert.deepEqual(bytes(st.raw.rfid), RFID.concat([0x07]), "…but the raw bytes survive");

  reply.rfid = RFID.slice(0, 12);                        // truncated mid-string
  st = await Niimbot.getStatus(FAST);
  assert.equal(st.decoded.rfid, null, "a truncated payload must not be half-decoded");
  console.log("ok  (e) RFID payload shapes: no-tag / capacity / trailing / truncated");

  // ── The whole point: this must not be wired into printing ──────────────────
  const src = require("node:fs").readFileSync(require("node:path").join(__dirname, "../src/niimbot.js"), "utf8");
  const callers = src.split("\n").filter((l) =>
    /getStatus\s*\(/.test(l) &&                 // a mention with a paren…
    !/function\s+getStatus\s*\(/.test(l) &&     // …that is not its own definition…
    !/^\s*(\/\/|\*)/.test(l));                  // …and not a comment about it.
  assert.equal(callers.length, 0, `no code in the driver may CALL getStatus(); found: ${callers.join(" | ")}`);

  await Niimbot.disconnect();
  await assert.rejects(() => Niimbot.getStatus(), /not connected/i, "after disconnect it must throw again");

  console.log("PASS — getStatus() exposes status without enforcing it. NO PRINTER INVOLVED;");
  console.log("       the field offsets are niimbluelib's and remain UNCONFIRMED on hardware.");
  process.exit(0);
})().catch((e) => { console.error("FAIL —", e && e.message ? e.message : e); process.exit(1); });
