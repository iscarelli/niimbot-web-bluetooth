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

  const VERSION = "b1-proto3-diag-7";   // bump on each change so the console proves fresh JS loaded
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

  // Flow control. The protocol-3 B1 silently drops rows under an unacked burst,
  // leaving the page incomplete (PageEnd never acks). "acked" (write-with-response)
  // gives per-packet ack + ordered delivery; "paced" falls back to unacked writes
  // with a short gap when the characteristic has no write property. The B1 Pro line
  // tolerates the fastest unacked writes, so it stays on "fast".
  let writeMode = "fast";   // "fast" | "acked" | "paced"
  const PACE_MS = 12;       // gap between unacked B1 writes so rows aren't dropped mid-page
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

  async function connect(model) {
    if (characteristic && device && device.gatt.connected) return;
    logMsg(`Niimbot ${VERSION} — connecting (task=${(model && model.task) || "?"})`);
    if (!navigator.bluetooth) throw new Error("Web Bluetooth unavailable (use Chrome/Edge over HTTPS).");
    const prefixes = (model && model.name_prefixes) || [];
    const filters = prefixes.length
      ? prefixes.map((p) => ({ namePrefix: p })) : [{ services: [SVC_UUID] }];
    device = await navigator.bluetooth.requestDevice({ filters, optionalServices: [SVC_UUID] });
    const server = await device.gatt.connect();
    const svc = await server.getPrimaryService(SVC_UUID);
    characteristic = await svc.getCharacteristic(CHAR_UUID);
    const p = characteristic.properties || {};
    writeMode = isB1(model) ? (p.write ? "acked" : "paced") : "fast";   // flow-control the B1 burst
    logMsg(`char props: write=${!!p.write} writeNoResp=${!!p.writeWithoutResponse} → writeMode=${writeMode}`);
    await characteristic.startNotifications();
    characteristic.addEventListener("characteristicvaluechanged", onNotify);
    device.addEventListener("gattserverdisconnected", () => { characteristic = null; });
    // Initial connection packet (raw, 0x03 prefix — same as niimblue).
    await writeRaw(new Uint8Array([0x03, 0x55, 0x55, 0xc1, 0x01, 0x01, 0xc1, 0xaa, 0xaa]));
    await sleep(200);
    if (isB1(model)) await b1Handshake();
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
  async function imageToPacked(url, w, h) {
    const bmp = await fetch(url).then((r) => r.blob()).then((b) => createImageBitmap(b));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
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
        await send(0x84, [(r >> 8) & 0xff, r & 0xff, run]);
      } else {
        const total = popcountRow(buf, off, stride);
        const data = new Array(6 + stride);
        data[0] = (r >> 8) & 0xff; data[1] = r & 0xff; data[2] = 0;
        data[3] = total & 0xff; data[4] = (total >> 8) & 0xff; data[5] = run;
        for (let b = 0; b < stride; b++) data[6 + b] = buf[off + b];
        await send(0x85, data);
      }
      r += run;
    }
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
  //         · SetPageSize 6b [H,W,copies] (cols = full label width, e.g. 400 for a
  //         50 mm label even though the printhead is 384) · shared total-mode rows
  //         · PageEnd · shared status-poll + PrintEnd. Byte-for-byte as niimbluelib.
  //         One full job per label (no cross-label pipelining).
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
  async function sendPagePacked(model, size, buf, stride, onProgress) {
    const W = size.w_px, H = size.h_px;
    if (isB1(model)) {
      await sendWait(0x03, [0x01], 0x04, 1000);                             // PageStart (B1 only)
      await sendWait(0x13, [
        (H >> 8) & 0xff, H & 0xff, (W >> 8) & 0xff, W & 0xff, 0, 1,
      ], 0x14, 2000);                                                       // SetPageSize 6b (rows, cols, copies=1)
    } else {
      await send(0xa3, [0x01]); await sleep(30);                           // PrintStatus (one-way)
      await sendWait(0x13, [
        (H >> 8) & 0xff, H & 0xff, (W >> 8) & 0xff, W & 0xff,
        0, 1, 0, 0, 0, 0, 0, 0, 0,
      ], 0x14, 2000);                                                       // SetPageSize 13b (1 copy)
    }

    onProgress && onProgress("sending image…");
    await sendImage(buf, H, stride);                                         // shared total-mode 0x84/0x85 encoder
    await sendWait(0xe3, [0x01], 0xe4, 3000);                                // PageEnd (0xE3)
  }

  // Poll until the cumulative printed-page counter (0xB3) reaches `target`.
  // Used both to throttle the look-ahead and to drain at end of job.
  async function waitPage(target, onProgress) {
    onProgress && onProgress("printing…");
    const t0 = Date.now();
    while (Date.now() - t0 < 25000) {
      const st = await getPrintStatus(900);
      if (st) { onProgress && onProgress(`printing… ${st.print}%`); if (st.page >= target) return; }
      await sleep(150);
    }
  }

  async function endJob() {
    await sendWait(0xf3, [0x01], 0xf4, 2500);                                // PrintEnd (0xF3)
  }

  // Finalize one label: poll the printed-page counter to 1 (so PrintEnd doesn't
  // arrive mid-print and cut the label), then PrintEnd. Same for both tasks — the
  // protocol-3 B1's 0xB3 status carries page in the same bytes (page→1 at 100%).
  async function finishJob(model, onProgress) {
    await waitPage(1, onProgress);
    await endJob();
  }

  async function printImage(url, opts) {
    opts = opts || {};
    const { model, size, onProgress } = opts;
    onProgress && onProgress("connecting…");
    await connect(model);
    const { buf, stride } = await imageToPacked(url, size.w_px, size.h_px);
    await beginJob(model, 1, onProgress);
    await sendPagePacked(model, size, buf, stride, onProgress);
    await finishJob(model, onProgress);
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
    const N = urls.length;
    // Protocol-3 B1: no cross-label pipelining — print one full job per label.
    if (isB1(model)) {
      for (let i = 0; i < N; i++) {
        const tag = `label ${i + 1}/${N}`;
        const { buf, stride } = await imageToPacked(urls[i], size.w_px, size.h_px);
        await beginJob(model, 1, (s) => onProgress && onProgress(`${tag}: ${s}`));
        await sendPagePacked(model, size, buf, stride, (s) => onProgress && onProgress(`${tag}: ${s}`));
        await finishJob(model, (s) => onProgress && onProgress(`${tag}: ${s}`));
      }
      onProgress && onProgress("ok");
      return;
    }
    // Single job for the whole batch: pages stream back-to-back, no retract between.
    await beginJob(model, N, onProgress);
    for (let i = 0; i < N; i++) {
      const tag = `label ${i + 1}/${N}`;
      onProgress && onProgress(`${tag}: sending…`);
      const { buf, stride } = await imageToPacked(urls[i], size.w_px, size.h_px);
      await sendPagePacked(model, size, buf, stride,
        (s) => onProgress && onProgress(`${tag}: ${s}`));
      // Send page i, THEN wait for page i-LOOKAHEAD to finish — so the just-sent
      // page is already buffered before the printer needs it (no inter-label stop).
      if (i - LOOKAHEAD >= 0) {
        await waitPage(i - LOOKAHEAD + 1, (s) => onProgress && onProgress(`${tag}: ${s}`));
      }
    }
    await waitPage(N, onProgress);                                          // drain remaining pages
    await endJob();
    onProgress && onProgress("ok");
  }

  root.Niimbot = {
    VERSION, SVC_UUID, CHAR_UUID,
    get DEBUG() { return DEBUG; }, set DEBUG(v) { DEBUG = !!v; },
    isSupported: () => !!navigator.bluetooth,
    connect, printImage, printBatch,
  };
})(typeof window !== "undefined" ? window : globalThis);
