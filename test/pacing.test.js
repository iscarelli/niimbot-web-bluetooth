/* Harness: Niimbot.WRITE_MODE (and its FORCE_PACING alias) — does the runtime
 * override actually change how BLE writes go out, in every direction, and only when
 * asked?
 *
 * No dependencies, no runner: `node test/pacing.test.js`. Exits non-zero on failure.
 * NO PRINTER IS INVOLVED — this measures write timing and which write METHOD was
 * called against a fake GATT characteristic. It says nothing about whether a real
 * label comes out; that is the maintainer's step, on hardware, looking at paper.
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

// ── Fake GATT: records every write (when, which method) and answers the driver ──
const writes = [];               // { t, kind: "unacked"|"acked", cmd, sub }
let notify = null;               // the driver's characteristicvaluechanged listener

// Which printer the fake answers as. Both are `task: "b1"` (so the 10-write handshake
// burst runs), but they differ in MODEL_IDS.paced — which is the whole point: 4608
// detects as "fast", 4096 detects as "paced".
const M2H = [0x12, 0x00];        // 4608 — M2-H, paced:false → detected "fast"
const B1 = [0x10, 0x00];         // 4096 — B1,   paced:true  → detected "paced"
let modelIdBytes = M2H;

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
function handle(bytes, kind) {
  if (bytes.length < 7 || bytes[0] !== 0x55 || bytes[1] !== 0x55) return; // e.g. the 0x03 connect packet
  const cmd = bytes[2], sub = bytes[4];
  writes.push({ t: performance.now(), kind, cmd, sub });
  if (cmd === 0xa5) {                       // PrinterStatusData → proto 4
    const d = new Array(13).fill(0); d[11] = 3; d[12] = 0;
    deliver(0xb5, d);
  } else if (cmd === 0x40 && sub === 0x08) { // PrinterModelId
    deliver(0x48, modelIdBytes);
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
  async writeValueWithoutResponse(bytes) { handle(bytes, "unacked"); },
  async writeValueWithResponse(bytes) { handle(bytes, "acked"); },
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

// Connect once with `override` in force, and report how the handshake burst went out.
// DEBUG stays OFF on purpose: the connect summary must be readable WITHOUT the packet
// dump, because that is the line a mobile tester reads in the demo's log panel.
async function connectAndMeasure(override, idBytes) {
  modelIdBytes = idBytes || M2H;
  writes.length = 0;
  const logs = [];
  const realLog = console.log;
  console.log = (...a) => { logs.push(a.join(" ")); };
  Niimbot.DEBUG = false;
  try {
    Niimbot.WRITE_MODE = override;
    await Niimbot.connect(MODEL);
  } finally {
    console.log = realLog;
    await Niimbot.disconnect();
  }
  const burst = writes.slice(-HANDSHAKE_WRITES);
  assert.equal(burst.length, HANDSHAKE_WRITES, "expected the 10-write B1 handshake burst");
  const gaps = burst.slice(1).map((w, i) => w.t - burst[i].t);
  return { gaps, logs, kinds: [...new Set(burst.map((w) => w.kind))] };
}

function fmt(gaps) { return gaps.map((g) => g.toFixed(1)).join(", "); }
const has = (logs, re) => logs.some((l) => re.test(l));

(async () => {
  const PACE = Niimbot.PACE_MS;
  const bursty = (gaps) => Math.max(...gaps) < PACE * 0.5;
  const spaced = (gaps) => Math.min(...gaps) >= PACE * 0.8;

  assert.equal(Niimbot.WRITE_MODE, null, "WRITE_MODE must default to null (auto)");
  assert.equal(Niimbot.FORCE_PACING, false, "FORCE_PACING must default to false");

  // ── 1. null (auto) on a model detected "fast": burst, no gap ───────────────
  // Without this case the suite would also pass against a driver that always paces.
  const auto = await connectAndMeasure(null);
  console.log(`WRITE_MODE=null   (M2-H) gaps(ms): ${fmt(auto.gaps)}`);
  assert.ok(bursty(auto.gaps), `auto on a "fast" model must not pace; largest gap ${Math.max(...auto.gaps).toFixed(1)}ms (PACE_MS=${PACE})`);
  assert.deepEqual(auto.kinds, ["unacked"], "auto/fast must use writeValueWithoutResponse");
  assert.equal(Niimbot.DETECTED_WRITE_MODE, "fast", "detected mode should be fast for the M2-H on Win32");
  assert.ok(has(auto.logs, /writeMode=fast\b.*override=auto\b.*effective=fast\b/), "connect line must report detected, override and effective mode");
  assert.ok(has(auto.logs, /forcePacing=false/), "connect line keeps the 1.4.0 forcePacing= field");

  // ── 2. null (auto) on a model detected "paced": the detection still rules ──
  const autoB1 = await connectAndMeasure(null, B1);
  console.log(`WRITE_MODE=null   (B1)   gaps(ms): ${fmt(autoB1.gaps)}`);
  assert.ok(spaced(autoB1.gaps), `the B1 must pace when nothing overrides it; smallest gap ${Math.min(...autoB1.gaps).toFixed(1)}ms`);
  assert.equal(Niimbot.DETECTED_WRITE_MODE, "paced", "the B1 must detect as paced");
  assert.ok(has(autoB1.logs, /writeMode=paced\b.*override=auto\b.*effective=paced\b/), "connect line must show paced/auto/paced for the B1");

  // ── 3. "paced" forced over a detected "fast" ───────────────────────────────
  const paced = await connectAndMeasure("paced");
  console.log(`WRITE_MODE=paced  (M2-H) gaps(ms): ${fmt(paced.gaps)}`);
  assert.ok(spaced(paced.gaps), `expected every write spaced by ~${PACE}ms; smallest gap ${Math.min(...paced.gaps).toFixed(1)}ms`);
  assert.deepEqual(paced.kinds, ["unacked"], "paced is unacked + a gap, not write-with-response");
  assert.equal(Niimbot.DETECTED_WRITE_MODE, "fast", "the DETECTED mode must not be mutated by the override");
  assert.ok(has(paced.logs, /writeMode=fast\b.*override=paced\b.*effective=paced\b.*forcePacing=true/), "connect line must show detected=fast, override=paced, effective=paced");

  // ── 4. "fast" forced over a detected "paced" — the iOS measurement ─────────
  // On a paced MODEL this is a diagnostic, so it must warn; and it must still obey.
  const fast = await connectAndMeasure("fast", B1);
  console.log(`WRITE_MODE=fast   (B1)   gaps(ms): ${fmt(fast.gaps)}`);
  assert.ok(bursty(fast.gaps), `forcing "fast" must actually drop the gap; largest gap ${Math.max(...fast.gaps).toFixed(1)}ms`);
  assert.equal(Niimbot.DETECTED_WRITE_MODE, "paced", "the DETECTED mode must survive a forced fast");
  assert.ok(has(fast.logs, /writeMode=paced\b.*override=fast\b.*effective=fast\b/), "connect line must show detected=paced, override=fast, effective=fast");
  assert.ok(has(fast.logs, /⚠ WRITE_MODE="fast" overrides Niimbot B1, which NEEDS pacing/), "forcing fast on a paced model must warn");
  // …and the warning must NOT fire where forcing fast is legitimate (a fast model).
  const fastOnFast = await connectAndMeasure("fast");
  assert.ok(!has(fastOnFast.logs, /NEEDS pacing/), "no pacing warning on a model that does not need pacing");

  // ── 5. "acked" — write-with-response, not unacked ──────────────────────────
  const acked = await connectAndMeasure("acked");
  console.log(`WRITE_MODE=acked  (M2-H) gaps(ms): ${fmt(acked.gaps)}`);
  assert.deepEqual(acked.kinds, ["acked"], "acked must call writeValueWithResponse for every write");
  assert.ok(bursty(acked.gaps), "acked must not add PACE_MS on top of the response round-trip");
  assert.equal(Niimbot.DETECTED_WRITE_MODE, "fast", "the DETECTED mode must not be mutated by an acked override");
  assert.ok(has(acked.logs, /writeMode=fast\b.*override=acked\b.*effective=acked\b/), "connect line must show detected=fast, override=acked, effective=acked");

  // ── 6. An invalid value throws instead of being silently ignored ───────────
  Niimbot.WRITE_MODE = "paced";
  for (const bad of ["turbo", "", "FAST", 1, true, {}, []]) {
    assert.throws(
      () => { Niimbot.WRITE_MODE = bad; },
      /WRITE_MODE must be null/,
      `WRITE_MODE = ${JSON.stringify(bad)} must throw`
    );
  }
  assert.equal(Niimbot.WRITE_MODE, "paced", "a rejected value must leave the previous override intact");
  Niimbot.WRITE_MODE = "auto";                 // the <select>-friendly spelling of null
  assert.equal(Niimbot.WRITE_MODE, null, '"auto" must be accepted as null');
  Niimbot.WRITE_MODE = undefined;
  assert.equal(Niimbot.WRITE_MODE, null, "undefined must clear the override");

  // ── 7. FORCE_PACING (1.4.0 API) round-trips as an alias, both directions ───
  Niimbot.WRITE_MODE = null;
  assert.equal(Niimbot.FORCE_PACING, false, "no override → FORCE_PACING false");
  Niimbot.FORCE_PACING = true;
  assert.equal(Niimbot.WRITE_MODE, "paced", "FORCE_PACING = true must set the override to paced");
  assert.equal(Niimbot.FORCE_PACING, true, "…and read back true");
  Niimbot.FORCE_PACING = false;
  assert.equal(Niimbot.WRITE_MODE, null, "FORCE_PACING = false must clear the override");
  Niimbot.WRITE_MODE = "paced";
  assert.equal(Niimbot.FORCE_PACING, true, 'WRITE_MODE = "paced" must read back as FORCE_PACING true');
  Niimbot.WRITE_MODE = "acked";
  assert.equal(Niimbot.FORCE_PACING, false, "only paced reads back as FORCE_PACING");
  Niimbot.FORCE_PACING = 1;
  assert.equal(Niimbot.FORCE_PACING, true, "FORCE_PACING setter coerces truthy to paced");
  assert.equal(Niimbot.WRITE_MODE, "paced");
  // The documented sharp edge: false clears a NON-paced override too, because a
  // boolean cannot express "not paced, but keep the other thing".
  Niimbot.WRITE_MODE = "fast";
  Niimbot.FORCE_PACING = false;
  assert.equal(Niimbot.WRITE_MODE, null, 'FORCE_PACING = false also clears a "fast" override (documented)');

  // ── 8. Read per write: flipping it needs no reconnect ──────────────────────
  Niimbot.WRITE_MODE = null;
  await Niimbot.connect(MODEL);
  assert.equal(Niimbot.EFFECTIVE_WRITE_MODE, "fast");
  writes.length = 0;
  Niimbot.WRITE_MODE = "acked";                // flipped mid-connection
  assert.equal(Niimbot.EFFECTIVE_WRITE_MODE, "acked", "the effective mode must follow the override immediately");
  assert.equal(Niimbot.DETECTED_WRITE_MODE, "fast", "…without touching what was detected");
  await Niimbot.identify(MODEL);               // no-op on an open connection…
  assert.equal(writes.length, 0, "identify on an open connection must not reconnect");
  await Niimbot.disconnect();
  Niimbot.WRITE_MODE = null;

  console.log("PASS — WRITE_MODE verified in all four positions (auto/fast/paced/acked),");
  console.log("       FORCE_PACING still round-trips, and the detected mode is never mutated.");
  console.log("       NO PRINTER INVOLVED: this measures write timing and write METHOD");
  console.log("       against a fake characteristic, not ink on paper.");
  process.exit(0);
})().catch((e) => { console.error("FAIL —", e && e.message ? e.message : e); process.exit(1); });
