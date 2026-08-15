/* ── niimbot.js — Web Bluetooth driver for Niimbot printers ───────────────────
 * Generic and application-agnostic. Protocol V4, with two print-task variants:
 *   "v4"  D11 / B1 Pro / B21 Pro line (300 dpi)  — validated on real B1 Pro
 *   "b1"  B1 / B21 line (203 dpi)                 — see registry.json `task`
 * Reverse-engineered against niimbluelib; the task is chosen per model.
 *
 * No dependencies, no build. Load with <script src="niimbot.js"></script> and
 * use the global `window.Niimbot` API. It reads no config of its own and owns no
 * UI — the app passes the printer model and label size (see registry.json). It
 * does `fetch` the image URL it is given and rasterize it on an offscreen
 * <canvas> (`imageToPacked`); nothing is added to the page.
 *
 *   await Niimbot.printImage(pngUrl, { model, size, onProgress });
 *   await Niimbot.printBatch([url1, url2], { model, size, onProgress });
 *
 * Both RESOLVE only when the printer confirmed the job — every page acknowledged
 * and the printed-page counter reaching the total. If it did not, they REJECT
 * with a message naming what stalled and where, after sending PrintEnd so the
 * paper is still fed out. They used to resolve either way, which is how a run
 * that printed 4 of 5 labels reported success (measured 2026-08-13). Treat a
 * rejection as "check the paper", not as "nothing printed": some of it did.
 *
 *   model: { name_prefixes:[], task, density, label_type, speed }  (from registry.json)
 *   size:  { w_px, h_px }                                      (from registry.json)
 *
 * Requirements: a browser with Web Bluetooth, over HTTPS (or localhost). Which
 * browsers qualify (and the iOS polyfill route) is in the README's Requirements
 * table — check Niimbot.isSupported() before offering it.
 *
 * Print flow (one job, N pages): connect → SetDensity → SetLabelType →
 *   PrintStart (declares N pages) → for each page: SetPageSize → rows
 *   (0x84 empty / 0x85 with pixels, run-length) → PageEnd (0xE3) → … →
 *   PrintEnd (0xF3) once at the end.
 *
 *   PrintEnd (0xF3) is what feeds out + retracts the paper, so it runs exactly
 *   once per job, not per page — otherwise the printer stops and pulls the paper
 *   back between every label. Pages are pipelined with a look-ahead (the next page
 *   is queued while the current one prints, throttled via the 0xA3→0xB3 status
 *   counter), which removes the retract between labels.
 *
 *   It does NOT always remove the PAUSE between labels, and this comment used to
 *   claim it did. Whether the paper keeps moving depends on which is faster, the
 *   send or the print. Measured on a B1 Pro, 2026-08-13, dense pages in "paced":
 *   ~255 row-writes × PACE_MS 10 ms ⇒ ~3 s to send a page, while the printer
 *   finished one in less — so it waited, and the pause is visible on the paper
 *   path. In "fast" the send is quick enough that the same batch streams. The
 *   look-ahead hides latency; it cannot create bandwidth.
 */
(function (root) {
  "use strict";

  const VERSION = "2.4.0";   // shown in the demo/console; bump on each release (or dev change)
  const SVC_UUID = "e7810a71-73ae-499d-8c15-faa9aef0c3f2";
  const CHAR_UUID = "bef8d6c9-9c21-4c9e-b632-bd58c1009f9f";
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ── Debug logging (toggle via Niimbot.DEBUG) ────────────────────────────────
  let DEBUG = false;
  // Tolerates null because `wantResp` legitimately IS null for the reads that accept
  // any response opcode (getStatus's heartbeat, the handshake's info reads). Without
  // this, the timeout WARNING below throws a TypeError — so a printer that simply went
  // quiet produced a hard error instead of the soft "no answer" the caller handles.
  const h2 = (b) => (b == null ? "—" : b.toString(16).padStart(2, "0"));
  const hex = (arr) => Array.from(arr).map(h2).join(" ");
  let _imgRows = 0; // coalesce the many 0x84/0x85 row packets into one log line
  function flushImg() {
    if (_imgRows && DEBUG) console.log(`[niimbot] →  (… ${_imgRows} image rows 0x84/0x85 …)`);
    _imgRows = 0;
  }
  function logTx(cmd, data) {
    if (!DEBUG) return;
    if (cmd === 0x84 || cmd === 0x85) { _imgRows++; return; }
    flushImg();
    console.log(`[niimbot] →  ${h2(cmd)} (${(data || []).length}b) ${hex(data || [])}`);
  }
  function logRx(cmd, data) { if (DEBUG) { flushImg(); console.log(`[niimbot] ←  ${h2(cmd)} (${data.length}b) ${hex(data)}`); } }
  function logMsg(m) { if (DEBUG) { flushImg(); console.log(`[niimbot] ·  ${m}`); } }
  // NOT gated behind DEBUG: which write path a print actually took must be readable
  // without turning on the packet dump that buries it (a phone has no console — the
  // demo's log panel mirrors console.log, and DEBUG off is its default). Reserved for
  // the few lines that answer "how did this print go out?".
  function logAlways(m) { flushImg(); console.log(`[niimbot] ·  ${m}`); }

  // Timing trace for batch diagnostics (concise: a few lines per batch), gated behind
  // DEBUG. Reveals whether an inter-label gap is us sending the next page late or the
  // printer idling after a page. Times are ms since the batch began.
  let _t0 = 0;
  function tlog(m) { if (DEBUG) console.log(`[niimbot t+${String(Date.now() - _t0).padStart(5)}ms] ${m}`); }

  // Connection reused across prints (module singleton).
  let device = null;
  let characteristic = null;
  let pending = null;        // { cmd, resolve } awaiting a response
  let lastUnsolicited = null; // last unsolicited response (e.g. status during the poll)

  // ── Frame V4: [0x55,0x55,cmd,len,...data,crc,0xAA,0xAA], crc = cmd^len^data ──
  function pack(cmd, data) {
    data = data || [];
    const pkt = new Uint8Array(7 + data.length);
    pkt[0] = 0x55; pkt[1] = 0x55; pkt[2] = cmd; pkt[3] = data.length;
    let crc = cmd ^ data.length;
    for (let i = 0; i < data.length; i++) { pkt[4 + i] = data[i]; crc ^= data[i]; }
    pkt[4 + data.length] = crc & 0xff;
    pkt[5 + data.length] = 0xaa; pkt[6 + data.length] = 0xaa;
    return pkt;
  }

  function onNotify(event) {
    const v = event.target.value; // DataView
    if (v.byteLength < 7) return;
    if (v.getUint8(0) !== 0x55 || v.getUint8(1) !== 0x55) return;
    const cmd = v.getUint8(2);
    const len = v.getUint8(3);
    const data = [];
    for (let i = 0; i < len && 4 + i < v.byteLength; i++) data.push(v.getUint8(4 + i));
    logRx(cmd, data);
    if (pending && (pending.cmd === cmd || pending.cmd === null)) {
      const p = pending; pending = null;
      p.resolve({ cmd, data });
    } else {
      lastUnsolicited = { cmd, data };
    }
  }

  // Flow control. Unacked writes (writeValueWithoutResponse) can be dropped under a
  // burst, leaving the page incomplete — on the B1 the page stalls; on macOS the page
  // comes out BLANK. "acked" = write-with-response (ordered, slow); "paced" = unacked
  // + a short gap; "fast" = unacked, no gap.
  //
  // ⚠ "fast" IS AN UNMEASURED DEFAULT, not a measured choice. This comment used to say
  // the B1 Pro / M2-H "take fast on Windows" and that Windows "tolerates" the burst.
  // Nothing ever measured that. As of 2026-08-13 the score is: THREE confirmed failures
  // in "fast" (a non-Mac desktop and an iPhone, both on dense content, plus the macOS
  // blank-page history) and ZERO confirmed successes in "fast" — every print known to
  // have succeeded either ran "paced" or ran on a machine whose OS nobody recorded.
  // Whether any platform actually needs the unpaced path is still open; see
  // docs/NOTES.md § Write mode. Do not restate the old claim without a measurement.
  // IS_MAC matches iOS TOO, and that is not a bug in the test: every iOS user agent
  // contains "like Mac OS X", and iOS is CoreBluetooth as well. The consequence is that
  // an iPhone has only ever printed PACED — whether it needs to is unmeasured. See the
  // write-mode override below, which is what makes that measurable.
  // MAC_SOURCE records WHICH input decided IS_MAC, and it is printed on the connect
  // line. Reason: on 2026-08-13 the same Chrome on the same Mac logged `mac=true` in one
  // session and `mac=false` in another, and `mac=false` alone could not say why — the
  // value is computed once at load, so the difference had to be in what `navigator`
  // reported (DevTools device emulation overrides BOTH `userAgentData.platform` and the
  // user agent, for instance). A boolean with no provenance turned that into hours of
  // guessing about which machine was used. Never remove this from the log line.
  let MAC_SOURCE = "?";
  const IS_MAC = (() => {
    try {
      if (navigator.userAgentData && navigator.userAgentData.platform) {
        // Report `platform` alongside it even though the decision ignores it: when the
        // two DISAGREE (uaData="Windows" while platform="MacIntel") something is
        // rewriting the identity — device emulation, a privacy extension, a spoofed UA
        // — and that contradiction is the single most useful thing this line can show.
        MAC_SOURCE = `uaData="${navigator.userAgentData.platform}" platform="${navigator.platform || ""}"`;
        return navigator.userAgentData.platform === "macOS";
      }
    } catch (e) {}
    const plat = navigator.platform || "";
    const ua = navigator.userAgent || "";
    const hit = /Mac/i.test(plat + " " + ua);
    // Say which of the two matched: on iOS it is the UA ("like Mac OS X"), on macOS
    // usually the platform ("MacIntel"). That distinction is the iOS/macOS tell.
    MAC_SOURCE = `platform="${plat}"${hit ? (/Mac/i.test(plat) ? " matched:platform" : " matched:ua") : ""}`;
    return hit;
  })();
  let writeMode = "fast";   // "fast" | "acked" | "paced" — as DETECTED at connect; the override below never overwrites it
  let PACE_MS = 10;         // gap (ms) between unacked writes so rows aren't dropped; runtime-tunable via Niimbot.PACE_MS

  // ── Write-mode override: an escape hatch in BOTH directions ─────────────────
  // Niimbot.WRITE_MODE forces "fast" | "paced" | "acked" over whatever connect()
  // detected; null (the default) means auto. Read per WRITE, not per connect, so it can
  // be flipped on an already-open connection, and `writeMode` above keeps reporting what
  // was DETECTED — the two are separate on purpose, so a log line can show both.
  //
  // Why it must force "fast" and not only "paced": IS_MAC matches iOS as well as macOS.
  // Every iOS user agent contains "like Mac OS X", so an iPhone matches — measured, not
  // assumed: the device's connect line reads `mac=true`. **iOS has therefore only ever
  // printed paced.** Whether it NEEDS the pacing is unmeasured, and the only way to find
  // out is to force "fast" there and look at the paper (README § iOS coverage has the
  // procedure). A one-directional FORCE_PACING could not ask that question.
  //
  // Sharp edge, deliberate: FORCE_PACING (published API in 1.4.0) is kept as an ALIAS —
  // reading it is `override === "paced"`, setting true sets "paced", setting false
  // clears the override to null. So `FORCE_PACING = false` also clears a "fast" or
  // "acked" override, because a boolean cannot express "not paced, but keep the other
  // thing". Use WRITE_MODE when that distinction matters.
  const WRITE_MODES = ["fast", "paced", "acked"];
  let writeOverride = null;
  function setWriteOverride(v) {
    const next = (v == null || v === "auto") ? null : v;
    if (next !== null && WRITE_MODES.indexOf(next) < 0) {
      throw new Error(`Niimbot.WRITE_MODE must be null (auto) or one of ${WRITE_MODES.map((m) => `"${m}"`).join(", ")} — got ${JSON.stringify(v)}.`);
    }
    writeOverride = next;
    logAlways(`WRITE_MODE override = ${next || "auto"} → effective=${effectiveWriteMode()} (detected=${writeMode})`);
    warnOverrideVsModel();
  }
  function effectiveWriteMode() {
    return writeOverride || writeMode;
  }
  // The 203 dpi B1 drops rows on an unpaced burst (MODEL_IDS `paced`), so forcing
  // "fast" there is a diagnostic, not a setting. Say so loudly — and still obey it:
  // refusing would put this driver in the business of overruling the measurement it
  // exists to make possible.
  function warnOverrideVsModel() {
    const meta = (printerInfo && printerInfo.modelId != null) ? MODEL_IDS[printerInfo.modelId] : null;
    if (writeOverride === "fast" && meta && meta.paced) {
      logAlways(`⚠ WRITE_MODE="fast" overrides ${meta.label}, which NEEDS pacing (${meta.dpi} dpi: it drops rows on an unpaced burst). Obeying — expect blank or short labels. This is a diagnostic, not a setting.`);
    }
  }
  async function writeRaw(bytes) {
    const mode = effectiveWriteMode();
    if (mode === "acked") { await characteristic.writeValueWithResponse(bytes); return; }
    // writeValueWithoutResponse pode estourar o buffer BLE em rajada — retry curto.
    let last = null;
    for (let tries = 0; tries < 30; tries++) {
      try {
        await characteristic.writeValueWithoutResponse(bytes);
        if (mode === "paced") await sleep(PACE_MS);
        return;
      } catch (e) { last = e; await sleep(4); }
    }
    // Name the mode: with an override in play, "unacked writes keep failing" may mean
    // the characteristic has no unacked path at all and "acked" is the only one it takes.
    throw new Error(`Failed to write to BLE in "${mode}" mode (buffer full, or this characteristic has no unacked write path)${last && last.message ? ": " + last.message : ""}`);
  }

  function send(cmd, data) { logTx(cmd, data); return writeRaw(pack(cmd, data)); }

  // Frame bundling. Each row is its own BLE write, and on the B1 every write costs a
  // ~10 ms pace — so a dense page (≈one packet per row) is dominated by the write
  // COUNT, not the bytes. The protocol is a frame stream and the printer reassembles
  // it, so several [55 55 … aa aa] frames can ride in one write, as long as the write
  // stays within the BLE MTU. BUNDLE_MAX = max bytes per write; 0 disables bundling
  // (one frame per write, the original behavior). Tunable at runtime via Niimbot.
  // Single 61 B frames already work, so the MTU is ≥ ~64; 240 is safe for MTU ≥ 247.
  let BUNDLE_MAX = 240;
  let _bundleAllowed = false;   // set per connected model (see MODEL_IDS `bundle`)
  let _bundle = [];      // pending raw frames awaiting a flush
  let _bundleLen = 0;
  async function flushBundle() {
    if (!_bundle.length) return;
    let out;
    if (_bundle.length === 1) { out = _bundle[0]; }
    else {
      out = new Uint8Array(_bundleLen);
      let o = 0;
      for (const f of _bundle) { out.set(f, o); o += f.length; }
    }
    _bundle = []; _bundleLen = 0;
    await writeRaw(out);
  }
  // Queue a frame into the current bundle, flushing first if it wouldn't fit. A frame
  // is never split (max(BUNDLE_MAX, frame.length) keeps an oversized frame whole).
  async function sendBundled(cmd, data) {
    logTx(cmd, data);
    const frame = pack(cmd, data);
    const max = _bundleAllowed ? BUNDLE_MAX : 0;   // 0 → one frame per write (B1 Pro, unknown models)
    if (_bundleLen && _bundleLen + frame.length > Math.max(max, frame.length)) await flushBundle();
    _bundle.push(frame); _bundleLen += frame.length;
  }

  async function sendWait(cmd, data, wantResp, timeoutMs) {
    const wait = new Promise((resolve) => { pending = { cmd: wantResp, resolve }; });
    await send(cmd, data);
    const res = await Promise.race([wait, sleep(timeoutMs).then(() => null)]);
    if (pending && pending.cmd === wantResp) pending = null; // clear on timeout
    if (!res) logMsg(`⚠ no response to ${h2(cmd)} (wanted ${wantResp == null ? "any" : h2(wantResp)}) after ${timeoutMs}ms`);
    return res; // { cmd, data } or null
  }

  async function getPrintStatus(timeoutMs) {
    lastUnsolicited = null;
    const wait = new Promise((resolve) => { pending = { cmd: 0xb3, resolve }; });
    await send(0xa3, [0x01]);
    const res = await Promise.race([wait, sleep(timeoutMs).then(() => null)]);
    if (pending && pending.cmd === 0xb3) pending = null;
    const r = res || (lastUnsolicited && lastUnsolicited.cmd === 0xb3 ? lastUnsolicited : null);
    if (!r || r.data.length < 4) return null;
    return { page: (r.data[0] << 8) | r.data[1], print: r.data[2], feed: r.data[3] };
  }

  // ── Printer identification ──────────────────────────────────────────────────
  // The B1 and B1 Pro advertise the SAME BLE name ("B1…"), so the name can't tell
  // them apart. niim.blue asks the printer for its model id (PrinterInfo 0x40[08] →
  // 0x48, big-endian u16) and protocol version (PrinterStatusData 0xA5 → 0xB5, bytes
  // [11]*100+[12]), then picks the print task from that. We do the same to validate
  // the caller's selection. That 0xB5 reply opcode is NOT universal: the D110 answers
  // 0xB5 with too few bytes and the N1 answers 0xB4 entirely, so `protocolVersion`
  // comes back null on both and no retry changes that — identification rests on the
  // model id, not on the protocol version.
  // Every id in the table below has printed on real hardware — B1 (4096), B1 Pro
  // (4097), D11_H (528), D110 (2304), M2-H (4608), N1 (3586), B2 Pro (6912) — with
  // ONE exception: the B1 SE (4098) is listed because it shares the b1 task and has
  // never been seen on a printer here. Models outside the table are reported, not
  // enforced.
  // The actual print width comes from the registry size's `w_px` (per label), so a
  // model-level printhead figure isn't needed here and is omitted to avoid confusing
  // it with label width (e.g. the M2-H reports a 576 px head in dc[03] while
  // T50x30_m2h renders at 567 px — a deliberate ribbon margin, not the head).
  // niimbluelib has the printhead resolutions if ever needed.
  // `paced` = needs the ~10 ms gap between unacked row writes (the 203 dpi B1 drops
  // rows on a full-speed burst). `bundle` = tolerates several row frames per BLE write
  // (frame bundling) — only enabled where validated; the B1 Pro garbles/stalls on
  // bundled writes, so it stays one-frame-per-write. `pagesPerJob` = caps how many
  // pages/copies a single job actually prints on this model (the D110 acks N but only
  // prints 1, see below). All three are per-MODEL, not per-task.
  const MODEL_IDS = {
    4096: { label: "Niimbot B1",     task: "b1", dpi: 203, paced: true,  bundle: true },
    4097: { label: "Niimbot B1 Pro", task: "v4", dpi: 300, paced: false, bundle: false },
    4098: { label: "Niimbot B1 SE",  task: "b1", dpi: 203, paced: true,  bundle: false },
    4608: { label: "Niimbot M2-H",   task: "b1", dpi: 300, paced: false, bundle: true },  // B1-Pro-class: b1 command sequence (per niimbluelib; v4 tested no better) + fast writes
    // D11_H, discovered 2026-08-13 by open discovery (it advertises "D11_H-…", and
    // reports protocol 5). The v4 sequence PRINTS on it — solid black came out on the
    // first attempt — which is what the protocol doc predicted and nobody had tried.
    // `paced`/`bundle` are the conservative defaults: neither has been measured here.
    528:  { label: "Niimbot D11_H", task: "v4", dpi: 300, paced: false, bundle: false },
    // D110, model id 2304, printed end to end on hardware 2026-08-14 (advertised name
    // "D110-FC06023035"). `task: "b1"` is MEASURED, not assumed. Driven as `v4` the
    // printer acked SetDensity (0x21→0x31), SetLabelType (0x23→0x33), PrintStart 9b
    // (0x01→0x02) and PrintStatus (0xa3→0xb3 = `00 00 00 00`), then went silent on
    // exactly the two commands that are v4-specific: SetPageSize 13-byte (0x13, no
    // 0x14) and PageEnd (0xe3, no 0xe4) — emitting an undocumented `0xdb` `06` at each.
    // Driven as `b1` (PageStart 0x03→0x04, SetPageSize 6-byte 0x13→0x14) every command
    // acked and the page printed. `dpi: 203` is MEASURED: 591 rows came out ≈ 73 mm →
    // 8.1 px/mm (300 dpi would have been 50 mm). `paced: true` is the mode that WORKED,
    // not a proven requirement: the b1 run wrote paced and the printer's own row
    // counter (0xd3) reached 590 of 591, so nothing was dropped — unpaced was never
    // tried on this model. `bundle: false` is the conservative default, never measured
    // here — same standing as the D11_H entry.
    // pagesPerJob: 1 — measured 2026-08-14. The D110 acks PrintStart pages=N and
    // SetPageSize copies=N exactly like any other b1-task model, but only actually
    // PRINTS the first page: a 3-copy upload prints ONE label and the page counter
    // parks at page 1 until PAGE_WAIT_MS gives up; a 3-page batch is refused mid-stream
    // with an undocumented `0xdb 06`. Three SEPARATE jobs print all three, clean. This
    // is per-MODEL, not per-task — do not add the field to another b1-task model
    // without measuring it broken the same way.
    2304: { label: "Niimbot D110",   task: "b1", dpi: 203, paced: true,  bundle: false, pagesPerJob: 1 },
    // B2 Pro, model id 6912 (0x1B00), advertised name e.g. "B2 Pro-I304050285",
    // protocol 5. Printed end to end on hardware 2026-08-14.
    // `task: "v4"` is MEASURED: SetDensity (0x21→0x31), SetLabelType (0x23→0x33),
    // PrintStart (0x01→0x02), the 13-byte SetPageSize (0x13→0x14) and PageEnd
    // (0xe3→0xe4) all acked, and PrintEnd (0xf3→0xf4) closed the job. None of the
    // v4-specific commands went silent — that silence is the D110's tell for a wrong
    // task.
    // `dpi: 300` is MEASURED against the label itself, not read off a datasheet: a
    // 354 px tall block filled a 30 mm label exactly, and a 354 px wide block left
    // ~20 mm of white beside it. At 203 dpi the same block would have been 44 mm and
    // overrun the label.
    // No `pagesPerJob`, and that ABSENCE is measured too: `copies: 3` printed three
    // labels with the printer's own counter stepping page 1 → 2 → 3.
    // `paced: false` is NOT a measurement — it is the absence of one. The capture ran
    // `paced` only because `IS_MAC` forces it; unpaced was never tried on this unit.
    // `false` is chosen over `true` because the field's ONLY effect is
    // warnOverrideVsModel(), whose text asserts the model "NEEDS pacing … it drops rows
    // on an unpaced burst" — a claim nobody here has evidence for on this model. Do not
    // read this `false` as measured.
    // `bundle: false` is the conservative default, never measured — same standing as
    // the D11_H (528) entry.
    6912: { label: "Niimbot B2 Pro", task: "v4", dpi: 300, paced: false, bundle: false },
    // N1, model id 3586 (0x0E02), advertised name e.g. "N1-H324110115", firmware 4.07.
    // Printed end to end on hardware 2026-08-14.
    // `task: "b1"` is MEASURED, and measured the hard way. Driven as `v4` the printer
    // acked SetDensity (0x21→0x31), SetLabelType (0x23→0x33) and PrintStart 9b
    // (0x01→0x02), then answered the 13-byte SetPageSize and PageEnd with `0xdb 06`
    // and nothing else — the same refusal signature the D110 gives for a wrong task.
    // Driven as `b1` (PrintStart 7b, PageStart 0x03→0x04, SetPageSize 6b 0x13→0x14)
    // every command acked, the page counter reached 1 at 100%/100%, and PrintEnd
    // (0xf3→0xf4) closed the job.
    // `dpi: 203` is MEASURED against the label, and it CONTRADICTS the spec sheet: the
    // N1 is SOLD AS 300 dpi. Do not "correct" this line. A row-numbered ruler printed
    // onto a 14 × 50 mm label was cut off after row 350, and row 350 landed ~45 mm down
    // a 50 mm label → ~7.8 px/mm, against 7.99 for 203 dpi. At 300 dpi (11.81 px/mm)
    // row 350 would have sat 29.6 mm down, leaving ~20 mm of blank label.
    // `paced: true` is the mode that WORKED, not a proven requirement: the capture ran
    // paced only because IS_MAC forces it, and unpaced was never tried on this model —
    // same standing as the D110 (2304) entry.
    // `bundle: false` is the conservative default, never measured here.
    // pagesPerJob: 1 — MEASURED 2026-08-14, and the printer agreed to the job first:
    // SetPageSize went out as `13 (6b) 01 90 00 60 00 03` (400 rows, 96 px, THREE
    // copies) and was acked with `14`, then `d3: 01 8f 01` reported row 399, so all 400
    // rows arrived — nothing was lost on the radio. One label printed, and the counter
    // parked at `page 1 / 100 % / 100 %` until PAGE_WAIT_MS expired and the driver
    // threw. This is per-MODEL: it says nothing about any other b1-task model that has
    // not been run the same way.
    3586: { label: "Niimbot N1",     task: "b1", dpi: 203, paced: true,  bundle: false, pagesPerJob: 1 },
  };
  let printerInfo = null;   // { modelId, protocolVersion, label, task, dpi } after connect

  async function detectPrinter() {
    printerInfo = null;
    let modelId = null, protocolVersion = null;
    const s = await sendWait(0xa5, [0x01], 0xb5, 1000);            // PrinterStatusData (order as niim.blue)
    if (s && s.data.length >= 13) {
      const n = s.data[11] * 100 + s.data[12];
      protocolVersion = (n >= 204 && n < 300) ? 3 : (n >= 302 ? 5 : (n >= 300 ? 4 : 0));
    }
    const r = await sendWait(0x40, [0x08], 0x48, 1000);           // PrinterModelId
    if (r && r.data.length >= 1) {
      modelId = r.data.length >= 2 ? ((r.data[0] << 8) | r.data[1]) : (r.data[0] << 8);
    }
    const meta = (modelId != null && MODEL_IDS[modelId]) || null;
    printerInfo = {
      modelId, protocolVersion,
      deviceName: (device && device.name) || null,   // advertised BLE name (for filtering)
      label: meta ? meta.label : (modelId != null ? `unknown (id ${modelId})` : "unknown"),
      task: meta ? meta.task : null,
      dpi: meta ? meta.dpi : null,
    };
    logMsg(`identified ${printerInfo.label} (id=${modelId}, proto=${protocolVersion}, task=${printerInfo.task || "?"}, name="${printerInfo.deviceName || "?"}")`);
    return printerInfo;
  }

  // Throw a clear, actionable error when the selected model/size doesn't match the
  // connected printer — stops a wrong-resolution print before it starts. No-op for an
  // unidentified printer (trust the caller). Called after connect, before printing.
  function assertSelection(model, size) {
    if (!printerInfo || printerInfo.task == null) return;
    if (model && model.task && model.task !== printerInfo.task) {
      throw new Error(`Connected printer is ${printerInfo.label} (task "${printerInfo.task}", ${printerInfo.dpi} dpi), but the selected model uses task "${model.task}". Select the ${printerInfo.label} model (and a matching label size).`);
    }
    if (size && size.dpi != null && printerInfo.dpi != null && size.dpi !== printerInfo.dpi) {
      throw new Error(`Selected label size is ${size.dpi} dpi but ${printerInfo.label} prints at ${printerInfo.dpi} dpi. Pick a ${printerInfo.dpi} dpi size.`);
    }
  }

  async function connect(model) {
    if (characteristic && device && device.gatt.connected) return;
    logMsg(`Niimbot ${VERSION} — connecting (task=${(model && model.task) || "?"})`);
    if (!navigator.bluetooth) throw new Error("Web Bluetooth unavailable (use Chrome/Edge over HTTPS).");
    const prefixes = (model && model.name_prefixes) || [];
    // Filter the chooser by advertised-name prefix (known per model).
    //
    // `acceptAllDevices: true` is the DISCOVERY path, for a printer this registry does
    // not know yet — its name prefix is exactly what you are trying to find out. It was
    // removed once as "we know the names now", which was true only for the models in the
    // registry; bringing up a new one had no way in.
    //
    // NO PREFIX ⇒ discovery. It used to fall back to `{ services: [SVC_UUID] }`, which
    // LOOKS like a discovery path and is not: that filter matches the service UUID **as
    // advertised**, and these printers do not advertise it — the service only becomes
    // visible after connecting. Measured 2026-08-13: with that filter the chooser was
    // empty for a D11 *and* for a B1 Pro, a printer this driver prints with every day.
    // A filter that cannot find hardware we own is not a filter, it is a dead end.
    const req = prefixes.length
      ? { filters: prefixes.map((p) => ({ namePrefix: p })), optionalServices: [SVC_UUID] }
      : { acceptAllDevices: true, optionalServices: [SVC_UUID] };
    device = await navigator.bluetooth.requestDevice(req);
    logMsg(`device name: "${device.name || "?"}"`);
    const server = await device.gatt.connect();
    const svc = await server.getPrimaryService(SVC_UUID);
    characteristic = await svc.getCharacteristic(CHAR_UUID);
    const props = characteristic.properties || {};
    writeMode = "fast";   // safe default for the tiny connect/detect packets; set per task below
    logMsg(`char props: write=${!!props.write} writeNoResp=${!!props.writeWithoutResponse}`);
    await characteristic.startNotifications();
    characteristic.addEventListener("characteristicvaluechanged", onNotify);
    // SAY IT. The printer drops the link on its own — it powers down when idle, and BLE
    // links die for their own reasons — and this listener is the only moment anything
    // knows. Clearing `characteristic` silently meant the next call failed with a bare
    // "Not connected", several screens away from the cause, with nothing in between:
    // on a phone, where this log panel is the only trace, that is unreadable. NOT gated
    // behind DEBUG, for the same reason the connect summary line is not.
    device.addEventListener("gattserverdisconnected", () => {
      const wasConnected = characteristic != null;
      characteristic = null;
      if (wasConnected) logMsg("printer disconnected (link dropped — reconnect to continue)");
    });
    // Initial connection packet (raw, 0x03 prefix — same as niimblue).
    await writeRaw(new Uint8Array([0x03, 0x55, 0x55, 0xc1, 0x01, 0x01, 0xc1, 0xaa, 0xaa]));
    await sleep(200);
    await detectPrinter();                 // identify B1 vs B1 Pro (same BLE name)
    // Flow control + arming follow the ACTUAL printer (detected), falling back to the
    // caller's pick when unidentified — so an identify-then-print flow (or a wrong
    // pick) still paces and arms a real B1 correctly.
    const meta = (printerInfo && printerInfo.modelId != null) ? MODEL_IDS[printerInfo.modelId] : null;
    const task = (meta && meta.task) || (printerInfo && printerInfo.task) || (model && model.task);
    // Flow control is per-MODEL, not per-task. Only the 203 dpi B1 drops rows on a
    // full-speed burst, so it paces; the B1 Pro and B1-Pro-class M2-H take the unpaced
    // "fast" burst (writeNoResponse, no gap) — same as the B1 Pro path. When the model
    // is unknown, default a b1-task printer to paced (safe) and never use slow acked
    // writes unless writeNoResponse is unavailable.
    const needsPacing = meta ? !!meta.paced : (task === "b1");
    writeMode = needsPacing ? (props.writeWithoutResponse ? "paced" : "acked") : "fast";
    _bundleAllowed = !!(meta && meta.bundle);   // only bundle frames where validated (B1, M2-H)
    if (IS_MAC && writeMode === "fast") writeMode = "paced";   // macOS (and iOS — see IS_MAC) drops unacked bursts → pace the "fast" models too
    // NOT DEBUG-gated: `effective=` is the answer to "which write path did this print
    // take?", and the previous wrong conclusion about iOS was reached precisely because
    // nobody could see it. One line per connect.
    logAlways(`writeMode=${writeMode} override=${writeOverride || "auto"} effective=${effectiveWriteMode()} forcePacing=${writeOverride === "paced"} bundle=${_bundleAllowed} mac=${IS_MAC} [${MAC_SOURCE}] pace=${PACE_MS} (task=${task || "?"}, model=${(meta && meta.label) || "?"}, write=${!!props.write}, writeNoResp=${!!props.writeWithoutResponse})`);
    warnOverrideVsModel();   // now that the model is identified, an override that fights it is worth saying
    if (task === "b1") await b1Handshake();
  }

  // Drop the BLE connection so a different printer can be paired/identified. Clears
  // all connection state (incl. the detected printerInfo); the next print reconnects.
  async function disconnect() {
    try { if (device && device.gatt && device.gatt.connected) device.gatt.disconnect(); }
    catch (e) { /* already gone */ }
    characteristic = null; device = null; pending = null; lastUnsolicited = null; printerInfo = null;
    logMsg("disconnected");
  }

  // The protocol-3 B1 will accept all the setup commands but never actually start
  // printing (PageEnd gets no 0xE4, status frozen at state 0x02) unless it first
  // sees the same post-connect handshake niim.blue does: read status + printer info
  // + a heartbeat. These are reads/keepalives that "arm" the printer for a job.
  async function b1Handshake() {
    logMsg("B1 handshake (status + info + heartbeat)");
    await sendWait(0xa5, [0x01], 0xb5, 1000);                  // PrinterStatusData
    for (const sub of [0x08, 0x0b, 0x0d, 0x0a, 0x07, 0x03, 0x0c, 0x09]) {
      await sendWait(0x40, [sub], null, 600);                  // PrinterInfo (response code varies)
    }
    await sendWait(0xdc, [0x04], 0xd9, 1000);                  // Heartbeat
  }

  // ── Consumable status: EXPOSED, never enforced ──────────────────────────────
  // Heartbeat (0xDC[04] → 0xD9) and RfidInfo (0x1A[01] → 0x1B) say whether the lid is
  // shut, paper is loaded and what the RFID consumable claims. NOTHING in this driver
  // reads these fields: no print path calls getStatus() or branches on it, and that is
  // still true now that some of them are hardware-confirmed. Six captures on ONE model
  // is not a licence to refuse a job into a printer that is actually loaded, so
  // `readiness()` below REPORTS and is wired to nothing.
  //
  // TRUST IS PER FIELD, not per response — `decoded.evidence` marks every decoded field
  // (see docs/protocol-v4.md § Consumable status for the capture table it comes from):
  //   "observed"     the byte moved on real hardware here exactly as the field name
  //                  says, each change isolated against a control. B1 Pro (model id
  //                  4097), response 0xD9, 13-byte payload, captures of 2026-08-11.
  //   "varies"       the byte was seen to move with the right physical event, but WHAT
  //                  it measures (or in what unit) is not settled. Better than a
  //                  transcription, short of confirmed.
  //   "inferred"     not confirmed here. Covers both niimbluelib's transcribed names and
  //                  a reading the captures support but do not prove (`printLimit`).
  // `raw` remains the contract: the exact response bytes, the only part that cannot be
  // wrong. Not for use mid-print: it shares the single `pending` slot with the print path.
  //
  // DELIBERATELY NOT DECODED, and each for a reason found in those captures:
  //   idx1  1.4.0 did not decode it; a later reading of its low nibble as an error code
  //         (0 none / 8 lid open / 3 out of paper) fit the first four captures and was
  //         REFUTED by c6 — 0x4a, low nibble `a`, taken right after a clean 3-label print
  //         with nothing wrong. Across the six it reads 88, 80, 83, 80, 80, 74: an analog
  //         quantity that sagged under load, not an enum. Unexplained; do not name it.
  //   idx7  `ribbonRfidSuccess` / `ribbonInserted` in 1.4.0. The B1 Pro is direct-thermal
  //   idx8  and has no ribbon at all, yet 1.4.0 reported `ribbonInserted: true` in every
  //         capture. A field that is confidently wrong is worse than an absent one.
  // Their bytes stay in `raw`, so a later capture can still settle them.
  const OBSERVED = "observed", VARIES = "varies", INFERRED = "inferred";

  // The one configuration whose bytes have actually been seen here: a B1 Pro answering
  // 0xD9 with a 13-byte payload. The B1 (4096) and M2-H (4608) have NEVER been captured
  // and may not even use this layout, so they get no hardware claim. That restriction is
  // not politeness: the NIIMBOT Community Wiki says of this very heartbeat that "for
  // specific printer models, lid-closed logic is inverted (1 = closed)", and our captures
  // show 1 = OPEN — so widening `lidClosed` to another model could invert its meaning.
  const OBSERVED_MODEL_ID = 4097;
  const observedHere = () => !!(printerInfo && printerInfo.modelId === OBSERVED_MODEL_ID);
  // The ribbon A/B was run on ONE printer, the M2-H. Scoping by payload length alone
  // would hand a hardware claim to any other model that happens to answer with 11
  // bytes — the exact leak the B1-Pro claims are already fenced against.
  const RIBBON_MODEL_ID = 4608;
  const ribbonObservedHere = () => !!(printerInfo && printerInfo.modelId === RIBBON_MODEL_ID);

  // niimbluelib abstraction.ts processHeartbeatAdvanced1: these model ids report the
  // lid byte inverted. None of MODEL_IDS is in it; kept so an unknown printer decodes
  // the same way niimbluelib would.
  const INVERTED_LID_MODELS = [512, 513, 514, 272, 273, 274, 1792, 2304, 2560, 3584, 3840, 4352, 5120];

  // Decode a heartbeat response into { hb, ev } — fields and their per-field evidence.
  // The LAYOUT IS PICKED BY THE RESPONSE OPCODE, then by payload length: `0xD9` is
  // In_HeartbeatAdvanced2 (what type 04 asks for), `0xDD` is In_HeartbeatAdvanced1.
  // `0xDE`/`0xDF` (Basic/Unknown) carry no fields niimbluelib decodes, so they yield
  // null rather than a guess. Polarity for 0xD9 is now the captures', not niimbluelib's,
  // and they agree: idx4 1 = lid open, idx5 1 = no paper, idx6 1 = tag read ok.
  function decodeHeartbeat(cmd, d) {
    const n = d.length;
    let hb = null;
    const ev = {};
    if (cmd === 0xd9) {                       // Advanced2 — needs ≥ 9 bytes
      if (n < 9) return null;
      hb = {
        layout: `advanced2/${n}`,
        chargeLevel: d[2], temp: d[3],
        lidClosed: d[4] === 0, paperInserted: d[5] === 0, paperRfidSuccess: d[6] !== 0,
        ribbonInserted: d[7] === 1,
      };
      // Only the captured configuration carries a hardware claim; anything else falls
      // back to "inferred", which here means "extrapolated and never checked".
      const seen = observedHere() && n === 13;
      ev.lidClosed = ev.paperInserted = ev.paperRfidSuccess = seen ? OBSERVED : INFERRED;
      // ribbonInserted is back, at a DIFFERENT offset from the one that was removed in
      // 2.0.0. That removal was right: the old offset read `true` on a B1 Pro, which is
      // direct-thermal and has no ribbon slot at all. d[7] is where it actually lives,
      // and it was established by the only kind of evidence that settles this — an A/B
      // on ONE printer, 10 s apart, with nothing changed but the ribbon:
      //     M2-H, ribbon in:  1f 5d 04 4b 00 00 01 [01] 00 00 00
      //     M2-H, ribbon out: 1f 5e 04 4b 00 00 01 [00] 00 00 00
      // and consistent with the B1 Pro (no ribbon, d[7] = 00) across its six captures.
      // ⚠ THE NAME IS THE WEAK PART, not the measurement. The NIIMBOT Community Wiki
      // (printers.niim.blue/interfacing/proto) documents TWO adjacent ribbon fields in
      // Advanced 2 — "Ribbon inserted" and "Ribbon RFID Success" — and pulling the
      // ribbon zeroes BOTH, so the A/B above cannot say which one d[7] is. It says only
      // that d[7] tracks the ribbon. `ribbonInserted` is the reading a caller can act on
      // ("a ribbon is in there and readable"); if a capture ever separates the two,
      // rename it rather than inventing a second field.
      // OBSERVED only on the 11-byte layout that A/B was run on; on 13 bytes it agrees
      // with a printer that HAS no ribbon, which cannot distinguish "absent" from
      // "field means something else here", so it stays inferred there.
      ev.ribbonInserted = (ribbonObservedHere() && n === 11) ? OBSERVED : INFERRED;
      // idx3 rose 0x48 idle → 0x49 before a job → 0x4a right after 3 labels, so it does
      // track something thermal. The UNIT is not settled: 72–74 is high for °C on a
      // lightly-used printhead. Hence "varies", not "observed".
      ev.temp = seen ? VARIES : INFERRED;
      // idx2 read 0x50 in all six captures — constant is not confirmed, only unrefuted.
      ev.chargeLevel = INFERRED;
      // Trailing wifiRssi / lightingErrorCode / voltageState are deliberately NOT
      // decoded: optional in niimbluelib and unverifiable here. They stay in `raw`.
    } else if (cmd === 0xdd) {                // Advanced1 — layout keyed off length
      if (n === 10) hb = { layout: "advanced1/10", lidClosed: d[8] === 0, chargeLevel: d[9] };
      else if (n === 13) hb = { layout: "advanced1/13", lidClosed: d[9] === 0, chargeLevel: d[10], paperInserted: d[11] === 0, paperRfidSuccess: d[12] !== 0 };
      else if (n === 19) hb = { layout: "advanced1/19", lidClosed: d[15] === 0, chargeLevel: d[16], paperInserted: d[17] === 0, paperRfidSuccess: d[18] !== 0 };
      else if (n === 20) hb = { layout: "advanced1/20", paperInserted: d[18] === 0, paperRfidSuccess: d[19] !== 0 };
      else return null;                       // unknown length → no half-filled object
      // Advanced1 has never been captured here at all: purely niimbluelib's.
      for (const k in hb) if (k !== "layout") ev[k] = INFERRED;
    } else {
      return null;
    }
    if (hb.lidClosed != null && printerInfo && INVERTED_LID_MODELS.indexOf(printerInfo.modelId) >= 0) {
      hb.lidClosed = !hb.lidClosed;
    }
    return { hb, ev };
  }

  // Decode an RfidInfo (0x1B) payload into { rfid, ev }, per niimbluelib processRfidInfo:
  //   1 byte                → no tag present
  //   uuid[8] · barCode(u8 len + bytes) · serial(u8 len + bytes) · printLimit(i16 BE,
  //   niimbluelib's `allPaper`) · usedPaper(i16 BE) · consumablesType(u8) · [capacity(i16 BE)]
  // niimbluelib's reader throws on an overrun AND on leftover bytes; both mean the
  // payload isn't this layout, so both return null here instead of a partial guess.
  // Two real 41-byte B1 Pro payloads (two different rolls) consume exactly, which
  // corroborates the STRUCTURE; the field meanings are separate, and marked one by one:
  //   usedPaper  went 6 → 9 across a 3-label job. Confirmed counter, and independently
  //              backed by the "printed label cnt" block in the NIIMBOT Community Wiki's
  //              RFID tag map.
  //   capacity   read 230, which the printer's owner confirmed is the roll's label count
  //              when new. Confirmed.
  //   printLimit niimbluelib calls this `allPaper`; it is NOT a paper total. It read 276
  //              against a 230-label roll and did not move across a print job, and on a
  //              second roll it read 120 against a capacity of 100 — the same 1.2 ratio,
  //              exactly. The wiki's tag map lists a "print limited cnt", so the reading
  //              is the consumable's DRM cap, provisioned at 120 % of nominal. Two rolls,
  //              one model, one label type: a well-supported inference, not a validated
  //              field. See docs/protocol-v4.md § Consumable status.
  // Never observed to VARY, so never promoted however sane they look: `consumablesType`
  // read 1 ("with gaps") on both rolls, and uuid/barCode/serialNumber differ per roll
  // without anything here confirming which is which.
  function decodeRfid(d) {
    if (d.length === 1) return { rfid: { tagPresent: false }, ev: { tagPresent: INFERRED } };
    let o = 0;
    const left = () => d.length - o;
    const i8 = () => d[o++];
    const i16 = () => { const v = ((d[o] << 8) | d[o + 1]) << 16 >> 16; o += 2; return v; };  // signed BE
    const str = (k) => { let s = ""; for (let i = 0; i < k; i++) s += String.fromCharCode(d[o + i]); o += k; return s; };
    if (left() < 8) return null;
    const uuid = Array.from(d.slice(0, 8)).map(h2).join("");
    o = 8;
    if (left() < 1 || left() < 1 + d[o]) return null;
    const barCode = str(i8());
    if (left() < 1 || left() < 1 + d[o]) return null;
    const serialNumber = str(i8());
    if (left() < 5) return null;                            // printLimit + usedPaper + type
    const info = { tagPresent: true, uuid, barCode, serialNumber, printLimit: i16(), usedPaper: i16(), consumablesType: i8() };
    if (left() === 2) info.capacity = i16();
    if (left() !== 0) return null;                          // extra data → not this layout
    // Unlike the heartbeat, this layout is self-describing (length-prefixed strings), so
    // a field keeps its meaning at any payload size — the model is the only scope needed.
    const seen = observedHere();
    const ev = {
      tagPresent: INFERRED, uuid: INFERRED, barCode: INFERRED, serialNumber: INFERRED,
      consumablesType: INFERRED, printLimit: INFERRED,
      usedPaper: seen ? OBSERVED : INFERRED,
    };
    if (info.capacity != null) ev.capacity = seen ? OBSERVED : INFERRED;
    return { rfid: info, ev };
  }

  // Ask the printer for its consumable status. Advisory only — see the block above.
  // Returns { raw: { heartbeat, heartbeatCmd, rfid }, decoded, confidence }:
  //   raw.heartbeat / raw.rfid  exact response payload bytes (Uint8Array) or null
  //   raw.heartbeatCmd          the response opcode, since it selects the layout
  //   decoded                   { heartbeat, rfid, evidence } — `heartbeat` and `rfid`
  //                             each independently null when that layout isn't
  //                             recognised, `evidence` the per-field trust map
  //                             ({ heartbeat, rfid }, matching keys); null when neither
  //                             part decoded
  //   confidence                a floor over `decoded.evidence`, kept for callers written
  //                             against 1.4.0: "validated" when at least one decoded
  //                             field is "observed" | "inferred" when something decoded
  //                             but nothing is confirmed | "unknown" when nothing did.
  //                             It is deliberately coarse — read `evidence` per field.
  // A missing 0x1B is NORMAL — many models/consumables never answer — so it times out
  // quietly and reports rfid: null rather than throwing.
  async function getStatus(opts) {
    // Name WHICH condition failed. The three have different causes and the old single
    // message hid that: `device` null means disconnect() was called, `characteristic`
    // null means the gattserverdisconnected event fired (the browser saw a drop), and
    // gatt.connected false means the link is down WITHOUT that event having run. A
    // session that ends unexpectedly is diagnosable only if these are told apart.
    if (!device) {
      throw new Error("Not connected — no device (disconnect() was called, or connect() never ran). Call Niimbot.connect(model) or Niimbot.identify(model) first.");
    }
    if (!characteristic) {
      throw new Error("Not connected — the link dropped (gattserverdisconnected fired and cleared the characteristic). Reconnect with Niimbot.connect(model).");
    }
    if (!(device.gatt && device.gatt.connected)) {
      throw new Error("Not connected — device.gatt.connected is false while the characteristic is still held, so the link went down without the disconnect event running. Reconnect with Niimbot.connect(model).");
    }
    const o = opts || {};
    const hbTimeout = o.timeoutMs != null ? o.timeoutMs : 1000;
    const rfidTimeout = o.rfidTimeoutMs != null ? o.rfidTimeoutMs : 600;
    // Accept ANY response opcode (wantResp null, as the handshake's info reads do)
    // instead of insisting on 0xD9: a printer that answers a different heartbeat
    // variant still hands us its raw bytes, which is the point. The opcode picks the
    // layout in decodeHeartbeat.
    const hb = await sendWait(0xdc, [0x04], null, hbTimeout);      // Heartbeat, type 04
    const rf = await sendWait(0x1a, [0x01], 0x1b, rfidTimeout);    // RfidInfo (optional)
    const hbDec = hb ? decodeHeartbeat(hb.cmd, hb.data) : null;
    const rfDec = rf ? decodeRfid(rf.data) : null;
    let decoded = null;
    if (hbDec || rfDec) {
      decoded = {
        heartbeat: hbDec ? hbDec.hb : null,
        rfid: rfDec ? rfDec.rfid : null,
        evidence: { heartbeat: hbDec ? hbDec.ev : null, rfid: rfDec ? rfDec.ev : null },
      };
    }
    return {
      raw: {
        heartbeat: hb ? Uint8Array.from(hb.data) : null,
        heartbeatCmd: hb ? hb.cmd : null,
        rfid: rf ? Uint8Array.from(rf.data) : null,
      },
      decoded,
      confidence: decoded ? (hasObserved(decoded.evidence) ? "validated" : "inferred") : "unknown",
    };
  }

  function hasObserved(evidence) {
    for (const part in evidence) {
      const m = evidence[part];
      for (const k in m) if (m[k] === OBSERVED) return true;
    }
    return false;
  }

  // REPORT — never enforce — whether a status looks print-ready. Pure: it takes what
  // getStatus() returned and calls nothing, so it can never delay or alter a print. It
  // exists so a future gate is easy to write in the APP, and is deliberately not wired
  // into printImage/printBatch: lid and paper are confirmed on one model from six
  // captures, which is not enough to refuse a job here.
  //   { ready: true | false | null, reasons: [strings], evidence: <weakest marker used> }
  // `ready` is null when nothing decoded bears on readiness — "cannot tell" and "not
  // ready" must not collapse into the same answer.
  function readiness(status) {
    const dec = status && status.decoded;
    const hb = dec && dec.heartbeat;
    const ev = (dec && dec.evidence && dec.evidence.heartbeat) || {};
    const reasons = [];
    const used = [];
    if (hb && hb.lidClosed != null) { used.push(ev.lidClosed); if (!hb.lidClosed) reasons.push("lid open"); }
    if (hb && hb.paperInserted != null) { used.push(ev.paperInserted); if (!hb.paperInserted) reasons.push("no paper"); }
    if (!used.length) return { ready: null, reasons: ["nothing decoded that bears on readiness"], evidence: null };
    const rank = [INFERRED, VARIES, OBSERVED];
    let weakest = OBSERVED;
    for (const m of used) {
      const mm = rank.indexOf(m) < 0 ? INFERRED : m;   // an unmarked field is not a claim
      if (rank.indexOf(mm) < rank.indexOf(weakest)) weakest = mm;
    }
    return { ready: reasons.length === 0, reasons, evidence: weakest };
  }

  // ── Bitmap: image → rows packed MSB-first (1 = black) ───────────────────────
  async function imageToPacked(url, w, h, offsetY) {
    const dy = offsetY | 0;   // print-position calibration (paper registration, not scale — w/h stay put); dy > 0 shifts down, dy < 0 shifts up
    const bmp = await fetch(url).then((r) => r.blob()).then((b) => createImageBitmap(b));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, dy, w, h);   // dy > 0 (e.g. T50x30_b1: +4): top dy rows stay white, bottom dy rows fall off the page.
                                       // dy < 0 (e.g. T15x50: -2): top |dy| rows of the SOURCE image are cut off, bottom |dy| rows of the page stay white.
                                       // Both directions are real hardware, not hypothetical: the B1 needed the print pushed down, the D110 needed it pulled up.
    const px = ctx.getImageData(0, 0, w, h).data;
    const stride = (w + 7) >> 3;
    const buf = new Uint8Array(stride * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
        if (px[i + 3] > 32 && lum < 128) buf[y * stride + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
    return { buf, stride };
  }

  function rowEmpty(buf, off, stride) {
    for (let b = 0; b < stride; b++) if (buf[off + b]) return false;
    return true;
  }
  function popcountRow(buf, off, stride) {
    let n = 0;
    for (let b = 0; b < stride; b++) { let v = buf[off + b]; while (v) { n += v & 1; v >>= 1; } }
    return n;
  }
  // Row-by-row bitmap (both tasks), grouping identical rows (run-length):
  // 0x84 (empty) / 0x85 (with pixels, count in "total mode" [00, lo, hi], repeat).
  // Verified byte-identical to niim.blue's B1 output.
  async function sendImage(buf, h, stride) {
    let r = 0;
    while (r < h) {
      const off = r * stride;
      const isVoid = rowEmpty(buf, off, stride);
      let run = 1;
      while (r + run < h && run < 200) {
        let same = true;
        const off2 = (r + run) * stride;
        for (let b = 0; b < stride; b++) if (buf[off + b] !== buf[off2 + b]) { same = false; break; }
        if (!same) break;
        run++;
      }
      if (isVoid) {
        await sendBundled(0x84, [(r >> 8) & 0xff, r & 0xff, run]);
      } else {
        const total = popcountRow(buf, off, stride);
        const data = new Array(6 + stride);
        data[0] = (r >> 8) & 0xff; data[1] = r & 0xff; data[2] = 0;
        data[3] = total & 0xff; data[4] = (total >> 8) & 0xff; data[5] = run;
        for (let b = 0; b < stride; b++) data[6 + b] = buf[off + b];
        await sendBundled(0x85, data);
      }
      r += run;
    }
    await flushBundle();   // push any rows still pending before PageEnd
  }

  // ── Job lifecycle (protocol V4) ─────────────────────────────────────────────
  // A "job" wraps one or more pages: PrintStart … (page)* … PrintEnd. The closing
  // PrintEnd (0xF3) is what makes the printer feed out + RETRACT the paper, so it
  // must run exactly once at the end — never between labels. Opening one job per
  // label (the old printOnePacked) caused a stop/retract between every label; the
  // Niimbot app keeps a single job open and streams pages back-to-back.

  // Two task variants (see registry.json `task`):
  //   "v4" (D110M / B1 Pro / B21 Pro, protocol 5-ish, 300 dpi): PrintStart 9b
  //         (speed + page count); a single job streams N pages; status-poll paced.
  //   "b1" (B1 / B21 / D11, *protocol 3*, 203 dpi): PrintStart 7b · PageStart [1]
  //         · SetPageSize 6b [H,W,copies] (cols = printhead width 384, multiple of 8)
  //         · shared total-mode rows · PageEnd · shared status-poll + PrintEnd.
  //         Byte-for-byte as niimbluelib's B1PrintTask. Like "v4", a single job
  //         streams N pages: printStart7b declares N, each PageEnd parks the paper at
  //         the printhead waiting for the next page, and the lone PrintEnd at the end
  //         feeds it out — so a batch prints continuously, no retract between labels.
  function isB1(model) { return model && model.task === "b1"; }

  // The connected, IDENTIFIED printer's MODEL_IDS entry, or null when unidentified —
  // used to gate `pagesPerJob` (and anything else that must key off the ACTUAL printer
  // rather than the caller's selection, which can be wrong). Mirrors the same lookup
  // already used for flow control in connect() / warnOverrideVsModel().
  function connectedMeta() {
    return (printerInfo && printerInfo.modelId != null) ? MODEL_IDS[printerInfo.modelId] : null;
  }

  // Print density, 1–5, the same scale the official NIIMBOT app exposes. It is a real
  // print parameter — the same label wants more heat on some stock than on others — so
  // it belongs per JOB, not baked into the model. `opts.density` wins; `model.density`
  // from registry.json is the fallback.
  //
  // VALIDATED, not passed through: an out-of-range byte goes to the printhead, and this
  // is the one setting in the driver that controls how hard it burns. Refusing loudly
  // beats discovering the limit on hardware.
  //
  // ⚠ 1–5 is the range the official app offers. Whether every model accepts all five is
  // NOT established here — nothing in this repo has measured a per-model maximum, and
  // the registry gives all four models the same default of 3.
  function densityFor(model, opts) {
    const raw = (opts && opts.density != null) ? opts.density : (model && model.density);
    const d = Number(raw);
    if (!Number.isInteger(d) || d < 1 || d > 5) {
      throw new Error(`density must be an integer 1–5 (got ${JSON.stringify(raw)}) — the scale the official app uses`);
    }
    return d;
  }

  async function beginJob(model, totalPages, onProgress, density) {
    onProgress && onProgress("configuring…");
    await sendWait(0x21, [density], 0x31, 1000);                             // SetDensity
    await sendWait(0x23, [model.label_type], 0x33, 1000);                   // SetLabelType
    const n = Math.max(1, totalPages | 0);
    const start = isB1(model)
      ? [(n >> 8) & 0xff, n & 0xff, 0, 0, 0, 0, 0]                          // printStart 7b
      : [(n >> 8) & 0xff, n & 0xff, 0, 0, 0, 0, 0, model.speed, 0];         // printStart 9b (…, speed, flag)
    await sendWait(0x01, start, 0x02, 2000);                                // PrintStart
  }

  // Queue one page's data within an open job — does NOT wait for it to print, so the
  // next page can be sent while this one is still printing. That keeps the printer
  // buffer primed when the send can keep up; in "paced" on dense pages it cannot (see
  // the header block), and the printer idles between labels waiting for data.
  async function sendPagePacked(model, size, buf, stride, copies, onProgress) {
    const W = size.w_px, H = size.h_px;
    const c = Math.max(1, copies | 0);   // printer repeats this page `c` times from one upload
    if (isB1(model)) {
      await sendWait(0x03, [0x01], 0x04, 1000);                             // PageStart (B1 only)
      await sendWait(0x13, [
        (H >> 8) & 0xff, H & 0xff, (W >> 8) & 0xff, W & 0xff, (c >> 8) & 0xff, c & 0xff,
      ], 0x14, 2000);                                                       // SetPageSize 6b (rows, cols, copies)
    } else {
      await send(0xa3, [0x01]); await sleep(30);                           // PrintStatus (one-way)
      await sendWait(0x13, [
        (H >> 8) & 0xff, H & 0xff, (W >> 8) & 0xff, W & 0xff,
        (c >> 8) & 0xff, c & 0xff, 0, 0, 0, 0, 0, 0, 0,
      ], 0x14, 2000);                                                       // SetPageSize 13b (copies)
    }

    onProgress && onProgress("sending image…");
    await sendImage(buf, H, stride);                                         // shared total-mode 0x84/0x85 encoder
    // RETURN whether PageEnd was acknowledged. Discarding this is how a page that the
    // printer never confirmed still got logged as "buffered (PageEnd acked)", directly
    // under the ⚠ warning saying it had not been.
    const pageEnd = await sendWait(0xe3, [0x01], 0xe4, 3000);                // PageEnd (0xE3)
    return pageEnd != null;
  }

  // How long to wait for the printed-page counter to reach a target before giving up.
  // Exposed because a test cannot afford to sit through the real value, and because an
  // unusually slow consumable is a legitimate reason to raise it.
  let PAGE_WAIT_MS = 25000;

  // Poll until the cumulative printed-page counter (0xB3) reaches `target`.
  // Used both to throttle the look-ahead and to drain at end of job.
  //
  // RETURNS true if the counter reached the target, false if the deadline passed.
  // It used to `return` from inside the loop and also fall out of it, so "printed" and
  // "gave up" were the same answer — which is how a job that stalled at page 4 of 5 was
  // reported as "all 5 pages printed" and resolved as success (measured 2026-08-13).
  // `_pageSeen` keeps the last counter value so the caller can say what it stalled at.
  let _lastPage = -1;   // last printed-page counter seen, for the timing trace
  let _pageSeen = null; // last counter value observed by waitPage, for error messages
  async function waitPage(target, onProgress) {
    onProgress && onProgress("printing…");
    const t0 = Date.now();
    _pageSeen = null;
    while (Date.now() - t0 < PAGE_WAIT_MS) {
      const st = await getPrintStatus(900);
      if (st) {
        _pageSeen = st.page;
        if (st.page !== _lastPage) { tlog(`printer counter → page ${st.page} (print ${st.print}%, feed ${st.feed}%)`); _lastPage = st.page; }
        onProgress && onProgress(`printing… ${st.print}%`);
        if (st.page >= target) return true;
      }
      await sleep(150);
    }
    return false;
  }

  // Build the message for a job that could not be confirmed. It names the numbers
  // because "print failed" would repeat the very mistake this path exists to fix: the
  // caller needs to know it stalled at page 4 of 5, and that the paper was fed out.
  function unconfirmed(reason) {
    return new Error(`print not confirmed: ${reason}. PrintEnd was sent, so the paper has been fed out — check the labels, they may be blank, short or repeated.`);
  }

  async function endJob() {
    await sendWait(0xf3, [0x01], 0xf4, 2500);                                // PrintEnd (0xF3)
  }

  // Finalize the job: poll the printed-page counter to `target` (so PrintEnd doesn't
  // arrive mid-print and cut a label), then PrintEnd. `target` = copies for a single
  // image (printer repeats it), so we wait for all copies before feeding out.
  //
  // ORDER MATTERS: PrintEnd goes out even when the wait failed, because PrintEnd is what
  // feeds out and RETRACTS the paper. Skipping it on the error path would leave the label
  // parked under the printhead. Only after it is sent does the failure become a throw.
  async function finishJob(model, target, onProgress) {
    const want = Math.max(1, target | 0);
    const reached = await waitPage(want, onProgress);
    await endJob();
    if (!reached) {
      throw unconfirmed(`printer counter stopped at page ${_pageSeen == null ? "?" : _pageSeen} of ${want} after ${PAGE_WAIT_MS}ms`);
    }
  }

  // Print one image, optionally `opts.copies` times. Like niim.blue, copies are
  // declared once (PrintStart pages + SetPageSize copies) and the image is uploaded
  // ONCE — the printer repeats it internally, continuously, no re-upload per copy.
  async function printImage(url, opts) {
    opts = opts || {};
    const { model, size, onProgress } = opts;
    const copies = Math.max(1, opts.copies | 0);
    const density = densityFor(model, opts);   // validate BEFORE touching the printer
    onProgress && onProgress("connecting…");
    await connect(model);
    assertSelection(model, size);
    const offsetY = opts.offsetY != null ? opts.offsetY : (size.offset_y_px || 0);
    const { buf, stride } = await imageToPacked(url, size.w_px, size.h_px, offsetY);
    _t0 = Date.now(); _lastPage = -1;                                        // timing trace (DEBUG)

    // pagesPerJob: 1 — this printer acks a multi-page/multi-copy job but only actually
    // prints the first page (see MODEL_IDS `2304` comment). Fall back to N separate
    // complete jobs instead. NOT gated behind DEBUG: the caller asked for one upload and
    // is about to wait N× as long for it, with the image crossing BLE N times instead of
    // once — silence here would just look like a slow print.
    const meta = connectedMeta();
    if (meta && meta.pagesPerJob === 1 && copies > 1) {
      logAlways(`⚠ ${meta.label} only prints page 1 of a multi-page job (measured 2026-08-14) — printing ${copies} copies as ${copies} separate jobs; the image crosses BLE ${copies} times.`);
      for (let i = 0; i < copies; i++) {
        const tag = `copy ${i + 1}/${copies}`;
        _lastPage = -1; _pageSeen = null;   // the printer's page counter resets at the start of EACH job (measured) — don't carry a stale value into the next one
        await beginJob(model, 1, (s) => onProgress && onProgress(`${tag}: ${s}`), density);
        tlog(`${tag}: job started (${size.w_px}×${size.h_px}, stride ${stride})`);
        const acked = await sendPagePacked(model, size, buf, stride, 1, (s) => onProgress && onProgress(`${tag}: ${s}`));
        tlog(acked ? `${tag}: image buffered (PageEnd acked)` : `${tag}: image sent but PageEnd went UNACKED`);
        if (!acked) {
          await endJob();                     // feed the paper out before failing (see finishJob)
          throw unconfirmed(`the printer never acknowledged PageEnd for ${tag}`);
        }
        await finishJob(model, 1, (s) => onProgress && onProgress(`${tag}: ${s}`));
      }
      tlog(`done (${copies} separate jobs, PrintEnd acked each)`);
      onProgress && onProgress("ok");
      return;
    }

    await beginJob(model, copies, onProgress, density);
    tlog(`job started (${copies} cop${copies > 1 ? "ies" : "y"}, ${size.w_px}×${size.h_px}, stride ${stride})`);
    const acked = await sendPagePacked(model, size, buf, stride, copies, onProgress);
    // Only claim the ack when there was one. The old line said "(PageEnd acked)"
    // unconditionally, including directly under the ⚠ warning that nothing answered.
    tlog(acked ? `image buffered (PageEnd acked)` : `image sent but PageEnd went UNACKED`);
    if (!acked) {
      await endJob();                       // feed the paper out before failing (see finishJob)
      throw unconfirmed("the printer never acknowledged PageEnd for the image");
    }
    await finishJob(model, copies, onProgress);
    tlog(`done (PrintEnd acked)`);
    onProgress && onProgress("ok");
  }

  // Keep at most this many pages buffered ahead of what has actually printed.
  // A page's send time is significant vs. its print time, so 1 page of head start
  // isn't enough — the next send loses the race and stalls. 2 gives each send a
  // full extra page of print-time to land, while a long batch still can't overrun
  // the printer's line buffer.
  const LOOKAHEAD = 2;

  async function printBatch(urls, opts) {
    opts = opts || {};
    const { model, size, onProgress } = opts;
    const density = densityFor(model, opts);   // validate BEFORE touching the printer
    onProgress && onProgress("connecting…");
    await connect(model);
    assertSelection(model, size);
    const N = urls.length;
    const offsetY = opts.offsetY != null ? opts.offsetY : (size.offset_y_px || 0);
    _t0 = Date.now(); _lastPage = -1;                                       // reset timing trace

    // pagesPerJob: 1 — see printImage for the same guard. A multi-page batch job on
    // this printer would ack every command and print only the first label, so run N
    // separate complete jobs instead: connect → job → job → … Semantics for the
    // caller are unchanged (N urls in ⇒ N labels out); only the wire behavior differs.
    const meta = connectedMeta();
    if (meta && meta.pagesPerJob === 1 && N > 1) {
      logAlways(`⚠ ${meta.label} only prints page 1 of a multi-page job (measured 2026-08-14) — sending ${N} labels as ${N} separate jobs; the image crosses BLE ${N} times.`);
      for (let i = 0; i < N; i++) {
        const tag = `label ${i + 1}/${N}`;
        onProgress && onProgress(`${tag}: sending…`);
        const { buf, stride } = await imageToPacked(urls[i], size.w_px, size.h_px, offsetY);
        tlog(`${tag}: start sending`);
        _lastPage = -1; _pageSeen = null;   // the printer's page counter resets at the start of EACH job (measured) — don't carry a stale value into the next one
        await beginJob(model, 1, (s) => onProgress && onProgress(`${tag}: ${s}`), density);
        const acked = await sendPagePacked(model, size, buf, stride, 1, (s) => onProgress && onProgress(`${tag}: ${s}`));
        tlog(acked ? `${tag}: buffered (PageEnd acked)` : `${tag}: sent but PageEnd went UNACKED`);
        if (!acked) {
          await endJob();                   // feed the paper out before failing (see finishJob)
          throw unconfirmed(`page ${i + 1} of ${N} was never acknowledged (no PageEnd ack)`);
        }
        await finishJob(model, 1, (s) => onProgress && onProgress(`${tag}: ${s}`));
      }
      tlog(`done (${N} separate jobs, PrintEnd acked each)`);
      onProgress && onProgress("ok");
      return;
    }

    // Single job for the whole batch (both tasks): pages stream back-to-back, no
    // retract between. The B1 (protocol 3) supports this natively — printStart7b
    // with totalPages>1 parks the paper at the printhead after each PageEnd and only
    // feeds out on the final PrintEnd (verified against niimbluelib's B1PrintTask).
    await beginJob(model, N, onProgress, density);
    tlog(`job started (${N} pages)`);
    // Anything that means "the printer stopped confirming" stops the loop. Sending more
    // pages into a printer that is not keeping up is how a batch ends up short AND
    // desynchronised — the 4-of-5 run on 2026-08-13 came out with every label numbered 1.
    let problem = null;
    for (let i = 0; i < N && !problem; i++) {
      const tag = `label ${i + 1}/${N}`;
      onProgress && onProgress(`${tag}: sending…`);
      const { buf, stride } = await imageToPacked(urls[i], size.w_px, size.h_px, offsetY);
      tlog(`page ${i}: start sending`);
      const acked = await sendPagePacked(model, size, buf, stride, 1,
        (s) => onProgress && onProgress(`${tag}: ${s}`));
      tlog(acked ? `page ${i}: buffered (PageEnd acked)` : `page ${i}: sent but PageEnd went UNACKED`);
      if (!acked) { problem = `page ${i + 1} of ${N} was never acknowledged (no PageEnd ack)`; break; }
      // Send page i, THEN wait for page i-LOOKAHEAD to finish — so the just-sent
      // page is already buffered before the printer needs it (no inter-label stop).
      if (i - LOOKAHEAD >= 0) {
        const want = i - LOOKAHEAD + 1;
        if (!await waitPage(want, (s) => onProgress && onProgress(`${tag}: ${s}`))) {
          problem = `printer counter stalled at page ${_pageSeen == null ? "?" : _pageSeen} of ${want} while streaming (${PAGE_WAIT_MS}ms)`;
        }
      }
    }
    if (!problem && !await waitPage(N, onProgress)) {                       // drain remaining pages
      problem = `printer counter stopped at page ${_pageSeen == null ? "?" : _pageSeen} of ${N} after ${PAGE_WAIT_MS}ms`;
    }
    // PrintEnd goes out either way — it is what feeds out and retracts the paper.
    // The throw comes after, never instead. (See finishJob for the same ordering.)
    tlog(problem ? `job UNCONFIRMED (${problem}); sending PrintEnd anyway` : `all ${N} pages printed; sending PrintEnd`);
    await endJob();
    if (problem) throw unconfirmed(problem);
    tlog(`PrintEnd acked (batch done)`);
    onProgress && onProgress("ok");
  }

  root.Niimbot = {
    VERSION, SVC_UUID, CHAR_UUID,
    get DEBUG() { return DEBUG; }, set DEBUG(v) { DEBUG = !!v; },
    get BUNDLE_MAX() { return BUNDLE_MAX; }, set BUNDLE_MAX(v) { BUNDLE_MAX = Math.max(0, v | 0); },
    get PACE_MS() { return PACE_MS; }, set PACE_MS(v) { PACE_MS = Math.max(0, v | 0); },
    // How long to wait for the printed-page counter before declaring a job unconfirmed.
    get PAGE_WAIT_MS() { return PAGE_WAIT_MS; }, set PAGE_WAIT_MS(v) { PAGE_WAIT_MS = Math.max(1, v | 0); },
    // Override the DETECTED write path: null (auto) | "fast" | "paced" | "acked".
    // Applied at write time, so it can be flipped mid-connection; anything else throws
    // rather than being ignored. See the "Write-mode override" block above.
    get WRITE_MODE() { return writeOverride; }, set WRITE_MODE(v) { setWriteOverride(v); },
    // What the driver DETECTED at connect, and what writes are actually using — the
    // pair a tester needs to tell "the override took effect" from "it was already that".
    get DETECTED_WRITE_MODE() { return writeMode; },
    get EFFECTIVE_WRITE_MODE() { return effectiveWriteMode(); },
    // DEPRECATED alias over WRITE_MODE, kept because it is published API as of 1.4.0:
    // true ⇔ override "paced"; `= false` clears the override entirely (including a
    // "fast" or "acked" one — a boolean cannot say "not paced, but keep that").
    get FORCE_PACING() { return writeOverride === "paced"; },
    set FORCE_PACING(v) { setWriteOverride(v ? "paced" : null); },
    get printer() { return printerInfo; },   // { modelId, protocolVersion, label, task, dpi } after connect
    isSupported: () => !!navigator.bluetooth,
    // ── DIAGNOSTIC, not API ────────────────────────────────────────────────────
    // Send one command and return whatever comes back, accepting ANY response opcode:
    //   await Niimbot.probe(0x1a, [0x02])   → { cmd, data } | null
    // It exists because protocol questions get answered by asking the printer, and the
    // alternative is guessing. Added 2026-08-13 while hunting where the M2-H reports
    // remaining RIBBON: every response the driver already collects (the whole b1
    // handshake, 0xA5→0xB5, all 0x40 info reads, the heartbeat and the RFID payload) is
    // byte-identical between a nearly-full ribbon and a half-spent one, so the figure
    // the official app shows must come from something nobody here asks for.
    //
    // ⚠ SWEEP SUB-CODES, NOT TOP-LEVEL OPCODES. Probing 0x40[00..20] or 0x1A[01..05] is
    // reading. Sweeping the top-level command space blind is not: this protocol has
    // commands that print, feed, write RFID and update firmware, and an unknown opcode
    // may be one of them. Nothing in the driver calls this.
    probe: async (cmd, data, timeoutMs) => {
      if (!characteristic) throw new Error("Not connected — probe needs an open connection.");
      return await sendWait(cmd, data || [], null, timeoutMs != null ? timeoutMs : 400);
    },
    // Connect and identify the printer (model id + protocol) without printing — the
    // app can read the returned info to auto-select the right model/size.
    identify: async (model) => { await connect(model); return printerInfo; },
    // Consumable status (lid/paper/RFID). ADVISORY: the driver itself never reads it.
    // Trust is PER FIELD — `decoded.evidence` says which fields were confirmed on real
    // hardware (B1 Pro only) and which are still niimbluelib's transcription. See the
    // "Consumable status" block above. `raw` carries the exact response bytes.
    getStatus,
    // Pure reporter over a getStatus() result — { ready, reasons, evidence }. NOT wired
    // into any print path, by design; call it yourself if your app wants to warn.
    readiness,
    connect, disconnect, printImage, printBatch,
  };
})(typeof window !== "undefined" ? window : globalThis);
