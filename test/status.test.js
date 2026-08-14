/* Harness: Niimbot.getStatus() — does the consumable-status decode hold its promise
 * that `raw` is exact and `decoded` never guesses?
 *
 * No dependencies, no runner: `node test/status.test.js`. Exits non-zero on failure.
 * NO PRINTER IS INVOLVED IN RUNNING THIS. Two kinds of fixture live here and the
 * difference is the whole point:
 *   RECORDED   the six B1 Pro heartbeats and two RfidInfo payloads below are bytes a
 *              real printer sent (2026-08-11, supplied to this repo — see
 *              docs/protocol-v4.md § Consumable status for the physical state recorded
 *              alongside each). Asserting against them checks the decode against
 *              hardware, which is why they are worth more than the rest of this file.
 *   SYNTHETIC  everything else is bytes this file made up to exercise the refusal paths
 *              (unknown length, silent RFID, malformed RFID). A PASS there proves the
 *              decoder matches a transcribed layout, NOT that a printer sends it.
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
// The model id the fake reports. 4097 = B1 Pro (where the heartbeat captures come
// from), 4096 = B1 (never captured — used to prove the hardware claim does NOT leak),
// 4608 = M2-H (where the ribbon A/B was run). Sent big-endian, as the printer does.
let modelId = 4097;

// Answered synchronously inside the write, exactly as in pacing.test.js.
function handle(bytes) {
  if (bytes.length < 7 || bytes[0] !== 0x55 || bytes[1] !== 0x55) return;  // 0x03 connect packet
  const cmd = bytes[2], sub = bytes[4];
  if (cmd === 0xa5) {                          // PrinterStatusData → protocol 5
    const d = new Array(13).fill(0); d[11] = 3; d[12] = 5;
    deliver(0xb5, d);
  } else if (cmd === 0x40 && sub === 0x08) {   // PrinterModelId
    deliver(0x48, [(modelId >> 8) & 0xff, modelId & 0xff]);
  } else if (cmd === 0x40) {
    // The info reads answer with opcode 0x40+sub (observed on a real M2-H handshake:
    // 40 0b → 4b, 40 0d → 4d, 40 0a → 4a …). Answering generically keeps the b1
    // handshake from sitting through eight timeouts.
    deliver(0x40 + sub, [0x00]);
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

  // ══ RECORDED — real B1 Pro bytes ═══════════════════════════════════════════
  // Six 0xD9 heartbeats captured on a Niimbot B1 Pro (model id 4097) on 2026-08-11,
  // with the physical state written down beside each. c1–c4 isolate one change at a
  // time against a control; c5/c6 bracket a 3-label print job. Bytes idx7..12 were
  // recorded as `00 …`, so they are padded with zeros here — inert, because nothing
  // past idx6 is decoded. The full derivation is in docs/protocol-v4.md.
  const cap = (b) => b.concat(new Array(13 - b.length).fill(0x00));
  //              idx0  idx1  idx2  idx3  idx4  idx5  idx6
  const C1 = cap([0x1f, 0x58, 0x50, 0x48, 0x01, 0x01, 0x00]);  // lid OPEN,   no paper, no tag
  const C2 = cap([0x1f, 0x50, 0x50, 0x48, 0x00, 0x00, 0x01]);  // lid closed, paper in, tag read
  const C3 = cap([0x1f, 0x53, 0x50, 0x48, 0x00, 0x01, 0x00]);  // lid closed, no paper, no tag
  const C4 = cap([0x1f, 0x50, 0x50, 0x48, 0x00, 0x00, 0x00]);  // lid closed, paper in, NO tag
  const C5 = cap([0x1f, 0x50, 0x50, 0x49, 0x00, 0x00, 0x01]);  // 22:15:16, just before 3 labels
  const C6 = cap([0x1f, 0x4a, 0x50, 0x4a, 0x00, 0x00, 0x01]);  // 22:15:40, just after them

  // Roll A: the real 41-byte RfidInfo payload from the same session. `used` is the one
  // field that moved (6 before the job → 9 after, for exactly 3 labels).
  const ascii = (s) => Array.from(s).map((c) => c.charCodeAt(0));
  const rollA = (used) => [].concat(
    [0x88, 0x1d, 0x15, 0xa4, 0xe1, 0x97, 0x00, 0x00],       // uuid
    [0x08], ascii("11262111"),                              // barCode
    [0x10], ascii("PC0G229321004571"),                      // serialNumber
    [0x01, 0x14],                                           // 276 — niimbluelib's "allPaper" = printLimit
    [0x00, used],                                           // usedPaper
    [0x01],                                                 // consumablesType
    [0x00, 0xe6]                                            // capacity = 230 = the new roll's labels
  );
  const RFID5 = rollA(6), RFID6 = rollA(9);
  // Roll B: a second physical roll. Everything differs — uuid, barcode, serial, counts —
  // which is what makes the printLimit / capacity ratio a relationship and not a
  // coincidence: 120/100 here, 276/230 on roll A, both exactly 1.2.
  const ROLL_B = [
    0x88, 0x1d, 0x19, 0x3c, 0x03, 0x13, 0x10, 0x80,
    0x08, 0x30, 0x32, 0x32, 0x37, 0x32, 0x33, 0x33, 0x33,
    0x10, 0x50, 0x4a, 0x30, 0x48, 0x39, 0x32, 0x35, 0x36, 0x37, 0x34, 0x30, 0x30, 0x30, 0x34, 0x37, 0x33,
    0x00, 0x78, 0x00, 0x03, 0x01, 0x00, 0x64,
  ];
  assert.equal(RFID5.length, 41, "roll A's recorded RfidInfo payload is 41 bytes");
  assert.equal(ROLL_B.length, 41, "roll B's recorded RfidInfo payload is 41 bytes");

  const HB_EXPECT = (temp, lid, paper, tag) => ({
    layout: "advanced2/13", chargeLevel: 0x50, temp,
    lidClosed: lid, paperInserted: paper, paperRfidSuccess: tag,
    // false in all six: the B1 Pro is direct-thermal and has no ribbon slot. Agreeing
    // with a printer that HAS no ribbon cannot confirm the offset — hence inferred below.
    ribbonInserted: false,
  });
  // Trust is per field: three booleans confirmed on hardware, temp seen to move but
  // with an unverified unit, chargeLevel never varied at all.
  const HB_EV = {
    lidClosed: "observed", paperInserted: "observed", paperRfidSuccess: "observed",
    temp: "varies", chargeLevel: "inferred", ribbonInserted: "inferred",
  };

  const CAPTURES = [
    ["c1", C1, HB_EXPECT(72, false, false, false)],
    ["c2", C2, HB_EXPECT(72, true, true, true)],
    ["c3", C3, HB_EXPECT(72, true, false, false)],
    ["c4", C4, HB_EXPECT(72, true, true, false)],
    ["c5", C5, HB_EXPECT(73, true, true, true)],
    ["c6", C6, HB_EXPECT(74, true, true, true)],
  ];
  let st;
  for (const [name, data, expect] of CAPTURES) {
    reply = { heartbeat: { cmd: 0xd9, data }, rfid: null };
    st = await Niimbot.getStatus(FAST);
    assert.deepEqual(bytes(st.raw.heartbeat), data, `${name}: raw.heartbeat must be the exact captured bytes`);
    assert.deepEqual(st.decoded.heartbeat, expect, `${name}: decoded heartbeat`);
    assert.deepEqual(st.decoded.evidence.heartbeat, HB_EV, `${name}: per-field evidence`);
    assert.equal(st.confidence, "validated", `${name}: hardware-confirmed fields make confidence 'validated'`);
    // `ribbonInserted` DID come back, at a different offset, once an A/B on a ribbon
    // printer established where it lives (see the r1 case below). Here it must read
    // FALSE — this printer has no ribbon slot — and it must stay `inferred`, because
    // agreeing with a printer that has no ribbon cannot confirm an offset.
    assert.equal(st.decoded.heartbeat.ribbonInserted, false, `${name}: a direct-thermal B1 Pro has no ribbon`);
    assert.equal(st.decoded.evidence.heartbeat.ribbonInserted, "inferred", `${name}: no hardware claim on this layout`);
    // `ribbonRfidSuccess` did NOT come back and must not: 1.4.0 reported it from an
    // unchecked offset, and unlike ribbonInserted nothing has since been measured for
    // it. A field that is confidently wrong is worse than an absent one.
    for (const gone of ["ribbonRfidSuccess"]) {
      assert.equal(gone in st.decoded.heartbeat, false, `${name}: ${gone} must not be decoded (never measured)`);
      assert.equal(gone in st.decoded.evidence.heartbeat, false, `${name}: ${gone} must not be marked either`);
    }
    // idx1 was once read as an error-code nibble (0 none / 8 lid open / 3 out of paper).
    // c6 refutes it: 0x4a right after a clean print, when nothing is wrong. Nothing may
    // name idx1 until a capture explains it.
    for (const k in st.decoded.heartbeat) {
      assert.equal(/error/i.test(k), false, `${name}: idx1 is unexplained — no error field may be decoded (found "${k}")`);
    }
  }
  console.log("ok  (h1) six recorded B1 Pro heartbeats: lid/paper/tag decode, no ribbon, no error enum");

  // c1 vs c3 move the lid alone; c3 vs c4 move the paper alone; c2 vs c4 move the tag
  // alone. Spelling the controls out here is what stops a "fits all six" rewrite.
  const dec = async (data) => { reply = { heartbeat: { cmd: 0xd9, data }, rfid: null }; return (await Niimbot.getStatus(FAST)).decoded.heartbeat; };
  const [hc1, hc2, hc3, hc4] = [await dec(C1), await dec(C2), await dec(C3), await dec(C4)];
  assert.notEqual(hc1.lidClosed, hc3.lidClosed, "c1 vs c3: only the lid moved, so only lidClosed may differ");
  assert.equal(hc1.paperInserted, hc3.paperInserted, "c1 vs c3: paper was absent in both");
  assert.notEqual(hc3.paperInserted, hc4.paperInserted, "c3 vs c4: only the paper moved");
  assert.equal(hc3.lidClosed, hc4.lidClosed, "c3 vs c4: the lid was shut in both");
  assert.notEqual(hc2.paperRfidSuccess, hc4.paperRfidSuccess, "c2 vs c4: only the tag moved");
  assert.equal(hc2.paperInserted, hc4.paperInserted, "c2 vs c4: paper was loaded in both — a missing tag is not missing paper");
  console.log("ok  (h2) each confirmed field moves with its own control and nothing else");

  // The recorded RFID payload must consume exactly, and usedPaper must show the job.
  reply = { heartbeat: { cmd: 0xd9, data: C5 }, rfid: RFID5 };
  st = await Niimbot.getStatus(FAST);
  assert.deepEqual(bytes(st.raw.rfid), RFID5, "raw.rfid must be the exact captured bytes");
  assert.deepEqual(st.decoded.rfid, {
    tagPresent: true, uuid: "881d15a4e1970000", barCode: "11262111",
    serialNumber: "PC0G229321004571", printLimit: 276, usedPaper: 6, consumablesType: 1,
    capacity: 230,
  }, "roll A: recorded RfidInfo fields");
  assert.deepEqual(st.decoded.evidence.rfid, {
    tagPresent: "inferred", uuid: "inferred", barCode: "inferred", serialNumber: "inferred",
    consumablesType: "inferred", printLimit: "inferred",
    usedPaper: "observed", capacity: "observed",
  }, "roll A: recorded RfidInfo per-field evidence");
  // 276 is NOT a quantity of paper: the roll holds 230 when new, and it did not move
  // across the print job. niimbluelib calls it `allPaper`; that name must not survive.
  assert.equal("allPaper" in st.decoded.rfid, false, "the misleading `allPaper` name must not be exposed");

  reply.rfid = RFID6;
  st = await Niimbot.getStatus(FAST);
  assert.equal(st.decoded.rfid.usedPaper, 9, "usedPaper must read 9 after the 3-label job");
  assert.equal(st.decoded.rfid.usedPaper - 6, 3, "usedPaper moved by exactly the 3 labels printed");
  assert.equal(st.decoded.rfid.capacity, 230, "capacity is the roll's size and must not move with a job");
  assert.equal(st.decoded.rfid.printLimit, 276, "printLimit did not move either — it is a cap, not a counter");
  console.log("ok  (h3) roll A: usedPaper 6→9 for 3 labels, capacity 230 and printLimit 276 both static");

  // Roll B — a different physical roll, and the reason printLimit has a name at all.
  reply.rfid = ROLL_B;
  st = await Niimbot.getStatus(FAST);
  assert.deepEqual(st.decoded.rfid, {
    tagPresent: true, uuid: "881d193c03131080", barCode: "02272333",
    serialNumber: "PJ0H925674000473", printLimit: 120, usedPaper: 3, consumablesType: 1,
    capacity: 100,
  }, "roll B: recorded RfidInfo fields");
  const ratio = (r) => r.printLimit / r.capacity;
  assert.equal(ratio(st.decoded.rfid), 1.2, "roll B: printLimit is 120 % of capacity");
  reply.rfid = RFID5;
  assert.equal(ratio((await Niimbot.getStatus(FAST)).decoded.rfid), 1.2, "roll A: the same 1.2, exactly");
  // Same on both rolls → never seen to vary → must not be sold as confirmed.
  assert.equal(st.decoded.evidence.rfid.consumablesType, "inferred",
    "consumablesType read 1 on both rolls, so nothing here confirms what it means");
  assert.equal(st.decoded.evidence.rfid.printLimit, "inferred",
    "two rolls and a wiki citation is a strong inference, not a validated field");
  console.log("ok  (h3') roll B: printLimit/capacity = 1.2 on both rolls, still inferred");

  // readiness() reports; it is a helper for the APP, never a gate here.
  reply = { heartbeat: { cmd: 0xd9, data: C2 }, rfid: null };
  assert.deepEqual(Niimbot.readiness(await Niimbot.getStatus(FAST)),
    { ready: true, reasons: [], evidence: "observed" }, "c2: lid shut + paper in → ready");
  reply.heartbeat.data = C1;
  assert.deepEqual(Niimbot.readiness(await Niimbot.getStatus(FAST)),
    { ready: false, reasons: ["lid open", "no paper"], evidence: "observed" }, "c1: both faults reported");
  assert.deepEqual(Niimbot.readiness({ decoded: null }),
    { ready: null, reasons: ["nothing decoded that bears on readiness"], evidence: null },
    "nothing decoded must be 'cannot tell' (null), never 'not ready' (false)");
  console.log("ok  (h4) readiness() reports ready/blocked/cannot-tell");

  // ══ SYNTHETIC — made-up bytes, exercising the refusal paths ════════════════
  // ── (a) A layout we decode: Advanced2 (0xD9), 9 bytes ──────────────────────
  // Same opcode, a length never captured, so nothing may claim hardware backing.
  const HB = [0x00, 0x00, 0x03, 0x19, 0x00, 0x00, 0x01, 0x00, 0x01];
  // uuid(8) · barCode "AB" · serial "S1" · allPaper 100 · usedPaper 3 · type 1
  const RFID = [1, 2, 3, 4, 5, 6, 7, 8, 2, 0x41, 0x42, 2, 0x53, 0x31, 0x00, 0x64, 0x00, 0x03, 0x01];
  reply = { heartbeat: { cmd: 0xd9, data: HB }, rfid: RFID };
  st = await Niimbot.getStatus(FAST);

  assert.deepEqual(bytes(st.raw.heartbeat), HB, "raw.heartbeat must be the exact bytes the printer sent");
  assert.equal(st.raw.heartbeatCmd, 0xd9, "raw must record the response opcode (it selects the layout)");
  assert.deepEqual(bytes(st.raw.rfid), RFID, "raw.rfid must be the exact bytes the printer sent");
  // A mixed status, and the reason per-field evidence exists: this heartbeat length was
  // never captured (nothing in it is confirmed) while the RFID payload is self-describing
  // and still yields a confirmed usedPaper on this model. The coarse top-level
  // `confidence` reports the strongest thing present; `evidence` is where the truth is.
  assert.equal(st.confidence, "validated", "one observed RFID field is enough for the coarse floor");
  assert.deepEqual(st.decoded.heartbeat, {
    layout: "advanced2/9",
    chargeLevel: 3, temp: 0x19,
    lidClosed: true, paperInserted: true, paperRfidSuccess: true, ribbonInserted: false,
  }, "Advanced2 heartbeat fields");
  assert.deepEqual(st.decoded.evidence.heartbeat, {
    lidClosed: "inferred", paperInserted: "inferred", paperRfidSuccess: "inferred",
    temp: "inferred", chargeLevel: "inferred", ribbonInserted: "inferred",
  }, "a length we never captured is inferred right across");
  assert.deepEqual(st.decoded.rfid, {
    tagPresent: true, uuid: "0102030405060708", barCode: "AB", serialNumber: "S1",
    printLimit: 100, usedPaper: 3, consumablesType: 1,
  }, "RfidInfo fields");
  console.log("ok  (a) known layout decoded, raw exact");

  // Same bytes, opposite polarity, so the booleans are read and not hardcoded.
  reply.heartbeat = { cmd: 0xd9, data: [0, 0, 4, 0x1a, 0x01, 0x01, 0x00, 0x01, 0x00] };
  st = await Niimbot.getStatus(FAST);
  assert.deepEqual(
    { l: st.decoded.heartbeat.lidClosed, p: st.decoded.heartbeat.paperInserted, r: st.decoded.heartbeat.paperRfidSuccess },
    { l: false, p: false, r: false },
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
  assert.deepEqual(st.decoded.evidence.heartbeat, {
    lidClosed: "inferred", chargeLevel: "inferred", paperInserted: "inferred", paperRfidSuccess: "inferred",
  }, "Advanced1 has never been captured here — every field stays niimbluelib's");
  assert.equal(st.confidence, "inferred", "…so it cannot be 'validated'");
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

  // ── (r1) ribbonInserted, from a controlled A/B on ONE printer ─────────────
  // RECORDED. The first two payloads are an M2-H ten seconds apart with nothing changed
  // but the ribbon; the third is the B1 Pro, which is direct-thermal and has no ribbon
  // slot. This is the evidence that put the field back after 2.0.0 removed it from a
  // different, unchecked offset — and the reason it is scoped to model 4608.
  const RIBBON_IN = [0x1f, 0x5d, 0x04, 0x4b, 0x00, 0x00, 0x01, 0x01, 0x00, 0x00, 0x00];
  const RIBBON_OUT = [0x1f, 0x5e, 0x04, 0x4b, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00];

  await Niimbot.disconnect();
  modelId = 4608;                                        // M2-H — where the A/B was run
  reply = { heartbeat: { cmd: 0xd9, data: RIBBON_IN }, rfid: null };
  await Niimbot.connect({ name_prefixes: ["M2"], task: "b1" });
  assert.equal(Niimbot.printer.modelId, 4608, "fake printer should identify as an M2-H");

  st = await Niimbot.getStatus(FAST);
  assert.equal(st.decoded.heartbeat.ribbonInserted, true, "ribbon fitted must read true");
  assert.equal(st.decoded.evidence.heartbeat.ribbonInserted, "observed",
    "the M2-H 11-byte layout is the one the A/B was run on, so it carries a hardware claim");

  reply = { heartbeat: { cmd: 0xd9, data: RIBBON_OUT }, rfid: null };
  st = await Niimbot.getStatus(FAST);
  assert.equal(st.decoded.heartbeat.ribbonInserted, false, "same printer, ribbon removed, must read false");
  assert.equal(st.decoded.evidence.heartbeat.ribbonInserted, "observed");

  // The claim must NOT leak to another model that happens to answer with 11 bytes.
  await Niimbot.disconnect();
  modelId = 4096;                                        // B1 — never captured
  reply = { heartbeat: { cmd: 0xd9, data: RIBBON_IN }, rfid: null };
  await Niimbot.connect({ name_prefixes: ["B1"], task: "b1" });
  st = await Niimbot.getStatus(FAST);
  assert.equal(st.decoded.heartbeat.ribbonInserted, true, "the byte still decodes");
  assert.equal(st.decoded.evidence.heartbeat.ribbonInserted, "inferred",
    "but an uncaptured model gets no hardware claim, however suggestive the byte");

  await Niimbot.disconnect();
  modelId = 4097;                                        // back to the B1 Pro for what follows
  await Niimbot.connect(MODEL);
  console.log("ok  (r1) ribbonInserted tracks the ribbon (A/B on the M2-H; no leak to other models)");

  // ── (c'') A printer that goes FULLY quiet must not throw ──────────────────
  // Regression, hit on real hardware 2026-08-13: the heartbeat is requested with
  // wantResp = null ("accept any opcode"), and the timeout WARNING formatted that null
  // as hex — so `h2(null)` threw a TypeError and a printer that simply stopped
  // answering produced "Cannot read properties of null (reading 'toString')" instead
  // of the soft, documented "no answer" result. Repeated status polls do go unanswered
  // on a real B1 Pro, so this is the ordinary case, not an exotic one.
  reply = { heartbeat: null, rfid: null };
  st = await Niimbot.getStatus({ timeoutMs: 40, rfidTimeoutMs: 40 });
  assert.equal(st.raw.heartbeat, null, "a silent heartbeat must be null, not an error");
  assert.equal(st.raw.heartbeatCmd, null);
  assert.equal(st.decoded, null, "nothing decodable means decoded === null");
  assert.equal(st.confidence, "unknown", "and the confidence says so rather than guessing");
  console.log("ok  (c'') a fully silent printer resolves with nulls instead of throwing");

  // Restore a live heartbeat: the timing check below measures the RFID wait ALONE, and
  // leaving the heartbeat silent would add its own timeout to the measurement.
  reply = { heartbeat: { cmd: 0xd9, data: HB }, rfid: null };

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

  // ── (f) The hardware claim must NOT leak to a model we never captured ──────
  // The NIIMBOT Community Wiki records that lid-closed polarity is INVERTED on some
  // models, so the very same byte could mean the opposite on a B1 (4096) or M2-H
  // (4608). Identical bytes, different printer → still decoded, never "observed".
  await Niimbot.disconnect();
  modelId = 4096;                                        // B1, never captured here
  reply = { heartbeat: { cmd: 0xd9, data: C2 }, rfid: RFID5 };
  await Niimbot.connect(MODEL);
  assert.equal(Niimbot.printer.modelId, 4096, "fake printer should now identify as a B1");
  st = await Niimbot.getStatus(FAST);
  assert.equal(st.confidence, "inferred", "the same bytes from an uncaptured model must not be 'validated'");
  assert.deepEqual(st.decoded.evidence.heartbeat, {
    lidClosed: "inferred", paperInserted: "inferred", paperRfidSuccess: "inferred",
    temp: "inferred", chargeLevel: "inferred", ribbonInserted: "inferred",
  }, "no heartbeat field may be marked observed on a model we have never captured");
  assert.equal(st.decoded.evidence.rfid.usedPaper, "inferred", "nor may an RFID field");
  assert.equal(st.decoded.evidence.rfid.capacity, "inferred");
  assert.equal(st.decoded.evidence.rfid.printLimit, "inferred", "…and printLimit was never a hardware claim anywhere");
  assert.equal(Niimbot.readiness(st).evidence, "inferred", "readiness must report the weakest evidence it used");
  console.log("ok  (f) the hardware claim is scoped to model 4097 (B1 Pro) and does not leak");

  // ── The whole point: this must not be wired into printing ──────────────────
  // Validating lid/paper on hardware is exactly when this gate gets tempting, so it
  // now covers readiness() too: a reporter that acquires a caller inside the driver
  // has become a gate.
  const src = require("node:fs").readFileSync(require("node:path").join(__dirname, "../src/niimbot.js"), "utf8");
  const uncalled = (name) => src.split("\n").filter((l) =>
    new RegExp(`${name}\\s*\\(`).test(l) &&              // a mention with a paren…
    !new RegExp(`function\\s+${name}\\s*\\(`).test(l) && // …that is not its own definition…
    !/^\s*(\/\/|\*)/.test(l));                           // …and not a comment about it.
  for (const name of ["getStatus", "readiness"]) {
    const callers = uncalled(name);
    assert.equal(callers.length, 0, `no code in the driver may CALL ${name}(); found: ${callers.join(" | ")}`);
  }

  await Niimbot.disconnect();
  await assert.rejects(() => Niimbot.getStatus(), /not connected/i, "after disconnect it must throw again");

  console.log("PASS — getStatus() exposes status without enforcing it. NO PRINTER RAN THIS TEST:");
  console.log("       the six B1 Pro captures are recorded bytes supplied to the repo, and only");
  console.log("       lid/paper/tag/usedPaper/capacity carry a hardware claim — on model 4097 only.");
  process.exit(0);
})().catch((e) => { console.error("FAIL —", e && e.message ? e.message : e); process.exit(1); });
