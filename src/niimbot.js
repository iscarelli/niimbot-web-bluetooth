/* ── niimbot.js — Web Bluetooth driver for Niimbot printers ───────────────────
 * Generic and application-agnostic. Protocol V4, with two print-task variants:
 *   "v4"  D11 / B1 Pro / B21 Pro line (300 dpi)  — validated on real B1 Pro
 *   "b1"  B1 / B21 line (203 dpi)                 — see registry.json `task`
 * Reverse-engineered against niimbluelib; the task is chosen per model.
 *
 * No dependencies, no build. Load with <script src="niimbot.js"></script> and
 * use the global `window.Niimbot` API. It never touches the DOM nor fetches any
 * config — the app passes the printer model and label size (see registry.json).
 *
 *   await Niimbot.printImage(pngUrl, { model, size, onProgress });
 *   await Niimbot.printBatch([url1, url2], { model, size, onProgress });
 *
 *   model: { name_prefixes:[], task, density, label_type, speed }  (from registry.json)
 *   size:  { w_px, h_px }                                      (from registry.json)
 *
 * Requirements: Chrome/Edge over HTTPS (or localhost). Web Bluetooth does not
 * exist on Firefox/Safari — check Niimbot.isSupported() before offering it.
 *
 * Print flow (one job, N pages): connect → SetDensity → SetLabelType →
 *   PrintStart (declares N pages) → for each page: SetPageSize → rows
 *   (0x84 empty / 0x85 with pixels, run-length) → PageEnd (0xE3) → … →
 *   PrintEnd (0xF3) once at the end.
 *
 *   PrintEnd (0xF3) is what feeds out + retracts the paper, so it runs exactly
 *   once per job, not per page — otherwise the printer stops and pulls the paper
 *   back between every label. Pages are pipelined with a 1-page look-ahead (the
 *   next page is queued while the current one prints, throttled via the 0xA3→0xB3
 *   status counter) so a batch streams continuously with no stop between labels.
 */
(function (root) {
  "use strict";

  const VERSION = "1.3.4";   // shown in the demo/console; bump on each release (or dev change)
  const SVC_UUID = "e7810a71-73ae-499d-8c15-faa9aef0c3f2";
  const CHAR_UUID = "bef8d6c9-9c21-4c9e-b632-bd58c1009f9f";
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ── Debug logging (toggle via Niimbot.DEBUG) ────────────────────────────────
  let DEBUG = false;
  const h2 = (b) => b.toString(16).padStart(2, "0");
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
  // comes out BLANK yet reports 100% (CoreBluetooth silently drops the burst that
  // Windows tolerates). "acked" = write-with-response (ordered, slow); "paced" = unacked
  // + a short gap; "fast" = unacked, no gap. The B1 Pro / M2-H take "fast" on Windows,
  // but on macOS every model is paced (see IS_MAC below) so rows aren't dropped.
  const IS_MAC = (() => {
    try { if (navigator.userAgentData && navigator.userAgentData.platform) return navigator.userAgentData.platform === "macOS"; } catch (e) {}
    return /Mac/i.test((navigator.platform || "") + " " + (navigator.userAgent || ""));
  })();
  let writeMode = "fast";   // "fast" | "acked" | "paced"
  let PACE_MS = 10;         // gap (ms) between unacked writes so rows aren't dropped; runtime-tunable via Niimbot.PACE_MS
  async function writeRaw(bytes) {
    if (writeMode === "acked") { await characteristic.writeValueWithResponse(bytes); return; }
    // writeValueWithoutResponse pode estourar o buffer BLE em rajada — retry curto.
    for (let tries = 0; tries < 30; tries++) {
      try {
        await characteristic.writeValueWithoutResponse(bytes);
        if (writeMode === "paced") await sleep(PACE_MS);
        return;
      } catch (e) { await sleep(4); }
    }
    throw new Error("Failed to write to BLE (buffer full?)");
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
    if (!res) logMsg(`⚠ no response to ${h2(cmd)} (wanted ${h2(wantResp)}) after ${timeoutMs}ms`);
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
  // the caller's selection. Validated ids: B1 (4096), B1 Pro (4097); the B1 SE (4098)
  // shares the b1 task. Other models exist but are untested → reported, not enforced.
  // `paced` = needs the ~10 ms gap between unacked row writes (the 203 dpi B1 drops
  // rows on a full-speed burst). The 300 dpi B1-Pro-class units (B1 Pro, M2-H) take
  // the unpaced "fast" burst, so flow control is per-MODEL, not per-task.
  // The actual print width comes from the registry size's `w_px` (per label), so a
  // model-level printhead figure isn't needed here and is omitted to avoid confusing
  // it with label width (e.g. B1 Pro 50×30 renders at 584 px though its printhead is
  // 567 px). niimbluelib has the printhead resolutions if ever needed.
  // `paced` = needs the ~10 ms gap between unacked row writes (the 203 dpi B1 drops
  // rows on a full-speed burst). `bundle` = tolerates several row frames per BLE write
  // (frame bundling) — only enabled where validated; the B1 Pro garbles/stalls on
  // bundled writes, so it stays one-frame-per-write. Both are per-MODEL, not per-task.
  const MODEL_IDS = {
    4096: { label: "Niimbot B1",     task: "b1", dpi: 203, paced: true,  bundle: true },
    4097: { label: "Niimbot B1 Pro", task: "v4", dpi: 300, paced: false, bundle: false },
    4098: { label: "Niimbot B1 SE",  task: "b1", dpi: 203, paced: true,  bundle: false },
    4608: { label: "Niimbot M2-H",   task: "b1", dpi: 300, paced: false, bundle: true },  // B1-Pro-class: b1 command sequence (per niimbluelib; v4 tested no better) + fast writes
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
    // Filter the chooser by advertised-name prefix (known per model). Empty → fall
    // back to the service UUID. (acceptAllDevices was only for first-time discovery
    // of an unknown model; we know the names now, so keep the chooser clean.)
    const filters = prefixes.length
      ? prefixes.map((p) => ({ namePrefix: p })) : [{ services: [SVC_UUID] }];
    device = await navigator.bluetooth.requestDevice({ filters, optionalServices: [SVC_UUID] });
    logMsg(`device name: "${device.name || "?"}"`);
    const server = await device.gatt.connect();
    const svc = await server.getPrimaryService(SVC_UUID);
    characteristic = await svc.getCharacteristic(CHAR_UUID);
    const props = characteristic.properties || {};
    writeMode = "fast";   // safe default for the tiny connect/detect packets; set per task below
    logMsg(`char props: write=${!!props.write} writeNoResp=${!!props.writeWithoutResponse}`);
    await characteristic.startNotifications();
    characteristic.addEventListener("characteristicvaluechanged", onNotify);
    device.addEventListener("gattserverdisconnected", () => { characteristic = null; });
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
    if (IS_MAC && writeMode === "fast") writeMode = "paced";   // macOS drops unacked bursts → pace the "fast" models too
    logMsg(`writeMode=${writeMode} bundle=${_bundleAllowed} mac=${IS_MAC} pace=${PACE_MS} (task=${task || "?"}, model=${(meta && meta.label) || "?"}, write=${!!props.write}, writeNoResp=${!!props.writeWithoutResponse})`);
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

  // ── Bitmap: image → rows packed MSB-first (1 = black) ───────────────────────
  async function imageToPacked(url, w, h, offsetY) {
    const dy = offsetY | 0;   // shift the print down by dy rows (print-position calibration)
    const bmp = await fetch(url).then((r) => r.blob()).then((b) => createImageBitmap(b));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, dy, w, h);   // top dy rows stay white; bottom dy rows fall off the page
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

  async function beginJob(model, totalPages, onProgress) {
    onProgress && onProgress("configuring…");
    await sendWait(0x21, [model.density], 0x31, 1000);                       // SetDensity
    await sendWait(0x23, [model.label_type], 0x33, 1000);                   // SetLabelType
    const n = Math.max(1, totalPages | 0);
    const start = isB1(model)
      ? [(n >> 8) & 0xff, n & 0xff, 0, 0, 0, 0, 0]                          // printStart 7b
      : [(n >> 8) & 0xff, n & 0xff, 0, 0, 0, 0, 0, model.speed, 0];         // printStart 9b (…, speed, flag)
    await sendWait(0x01, start, 0x02, 2000);                                // PrintStart
  }

  // Queue one page's data within an open job — does NOT wait for it to print, so
  // the next page can be sent while this one is still printing (keeps the printer
  // buffer primed → no stop between labels).
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
    await sendWait(0xe3, [0x01], 0xe4, 3000);                                // PageEnd (0xE3)
  }

  // Poll until the cumulative printed-page counter (0xB3) reaches `target`.
  // Used both to throttle the look-ahead and to drain at end of job.
  let _lastPage = -1;   // last printed-page counter seen, for the timing trace
  async function waitPage(target, onProgress) {
    onProgress && onProgress("printing…");
    const t0 = Date.now();
    while (Date.now() - t0 < 25000) {
      const st = await getPrintStatus(900);
      if (st) {
        if (st.page !== _lastPage) { tlog(`printer counter → page ${st.page} (print ${st.print}%, feed ${st.feed}%)`); _lastPage = st.page; }
        onProgress && onProgress(`printing… ${st.print}%`);
        if (st.page >= target) return;
      }
      await sleep(150);
    }
  }

  async function endJob() {
    await sendWait(0xf3, [0x01], 0xf4, 2500);                                // PrintEnd (0xF3)
  }

  // Finalize the job: poll the printed-page counter to `target` (so PrintEnd doesn't
  // arrive mid-print and cut a label), then PrintEnd. `target` = copies for a single
  // image (printer repeats it), so we wait for all copies before feeding out.
  async function finishJob(model, target, onProgress) {
    await waitPage(Math.max(1, target | 0), onProgress);
    await endJob();
  }

  // Print one image, optionally `opts.copies` times. Like niim.blue, copies are
  // declared once (PrintStart pages + SetPageSize copies) and the image is uploaded
  // ONCE — the printer repeats it internally, continuously, no re-upload per copy.
  async function printImage(url, opts) {
    opts = opts || {};
    const { model, size, onProgress } = opts;
    const copies = Math.max(1, opts.copies | 0);
    onProgress && onProgress("connecting…");
    await connect(model);
    assertSelection(model, size);
    const offsetY = opts.offsetY != null ? opts.offsetY : (size.offset_y_px || 0);
    const { buf, stride } = await imageToPacked(url, size.w_px, size.h_px, offsetY);
    _t0 = Date.now(); _lastPage = -1;                                        // timing trace (DEBUG)
    await beginJob(model, copies, onProgress);
    tlog(`job started (${copies} cop${copies > 1 ? "ies" : "y"}, ${size.w_px}×${size.h_px}, stride ${stride})`);
    await sendPagePacked(model, size, buf, stride, copies, onProgress);
    tlog(`image buffered (PageEnd acked)`);
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
    onProgress && onProgress("connecting…");
    await connect(model);
    assertSelection(model, size);
    const N = urls.length;
    const offsetY = opts.offsetY != null ? opts.offsetY : (size.offset_y_px || 0);
    _t0 = Date.now(); _lastPage = -1;                                       // reset timing trace
    // Single job for the whole batch (both tasks): pages stream back-to-back, no
    // retract between. The B1 (protocol 3) supports this natively — printStart7b
    // with totalPages>1 parks the paper at the printhead after each PageEnd and only
    // feeds out on the final PrintEnd (verified against niimbluelib's B1PrintTask).
    await beginJob(model, N, onProgress);
    tlog(`job started (${N} pages)`);
    for (let i = 0; i < N; i++) {
      const tag = `label ${i + 1}/${N}`;
      onProgress && onProgress(`${tag}: sending…`);
      const { buf, stride } = await imageToPacked(urls[i], size.w_px, size.h_px, offsetY);
      tlog(`page ${i}: start sending`);
      await sendPagePacked(model, size, buf, stride, 1,
        (s) => onProgress && onProgress(`${tag}: ${s}`));
      tlog(`page ${i}: buffered (PageEnd acked)`);
      // Send page i, THEN wait for page i-LOOKAHEAD to finish — so the just-sent
      // page is already buffered before the printer needs it (no inter-label stop).
      if (i - LOOKAHEAD >= 0) {
        await waitPage(i - LOOKAHEAD + 1, (s) => onProgress && onProgress(`${tag}: ${s}`));
      }
    }
    await waitPage(N, onProgress);                                          // drain remaining pages
    tlog(`all ${N} pages printed; sending PrintEnd`);
    await endJob();
    tlog(`PrintEnd acked (batch done)`);
    onProgress && onProgress("ok");
  }

  root.Niimbot = {
    VERSION, SVC_UUID, CHAR_UUID,
    get DEBUG() { return DEBUG; }, set DEBUG(v) { DEBUG = !!v; },
    get BUNDLE_MAX() { return BUNDLE_MAX; }, set BUNDLE_MAX(v) { BUNDLE_MAX = Math.max(0, v | 0); },
    get PACE_MS() { return PACE_MS; }, set PACE_MS(v) { PACE_MS = Math.max(0, v | 0); },
    get printer() { return printerInfo; },   // { modelId, protocolVersion, label, task, dpi } after connect
    isSupported: () => !!navigator.bluetooth,
    // Connect and identify the printer (model id + protocol) without printing — the
    // app can read the returned info to auto-select the right model/size.
    identify: async (model) => { await connect(model); return printerInfo; },
    connect, disconnect, printImage, printBatch,
  };
})(typeof window !== "undefined" ? window : globalThis);
