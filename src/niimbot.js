/* ── niimbot.js — driver Web Bluetooth para impressoras Niimbot ───────────────
 * Genérico e agnóstico de aplicação. Protocolo V4 (linha D11 / B1 Pro / B21 Pro),
 * obtido por engenharia reversa e validado em hardware real na B1 Pro.
 *
 * Sem dependências, sem build. Carregue com <script src="niimbot.js"></script> e
 * use a API global `window.Niimbot`. Não toca no DOM nem busca configuração —
 * o app passa o modelo e o tamanho da etiqueta (ver registry.json).
 *
 *   await Niimbot.printImage(pngUrl, { model, size, onProgress });
 *   await Niimbot.printBatch([url1, url2], { model, size, onProgress });
 *
 *   model: { name_prefixes:[], density, label_type, speed }   (de registry.json)
 *   size:  { w_px, h_px }                                      (de registry.json)
 *
 * Requisitos: Chrome/Edge em HTTPS (ou localhost). Web Bluetooth não existe em
 * Firefox/Safari — cheque Niimbot.isSupported() antes de oferecer o recurso.
 *
 * Fluxo de impressão: connect → SetDensity → SetLabelType → PrintStart →
 *   SetPageSize → linhas (0x84 vazia / 0x85 com pixels, run-length) → 0xE3 →
 *   poll de status (0xA3→0xB3) até a página concluir → PrintEnd (0xF3).
 */
(function (root) {
  "use strict";

  const SVC_UUID = "e7810a71-73ae-499d-8c15-faa9aef0c3f2";
  const CHAR_UUID = "bef8d6c9-9c21-4c9e-b632-bd58c1009f9f";
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Conexão reaproveitada entre impressões (singleton de módulo).
  let device = null;
  let characteristic = null;
  let pending = null;        // { cmd, resolve } aguardando uma resposta
  let lastUnsolicited = null; // última resposta não aguardada (ex.: status no poll)

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
    if (pending && (pending.cmd === cmd || pending.cmd === null)) {
      const p = pending; pending = null;
      p.resolve({ cmd, data });
    } else {
      lastUnsolicited = { cmd, data };
    }
  }

  async function writeRaw(bytes) {
    // writeValueWithoutResponse pode estourar o buffer BLE em rajada — retry curto.
    for (let tries = 0; tries < 30; tries++) {
      try { await characteristic.writeValueWithoutResponse(bytes); return; }
      catch (e) { await sleep(4); }
    }
    throw new Error("Falha ao escrever no BLE (buffer cheio?)");
  }

  function send(cmd, data) { return writeRaw(pack(cmd, data)); }

  async function sendWait(cmd, data, wantResp, timeoutMs) {
    const wait = new Promise((resolve) => { pending = { cmd: wantResp, resolve }; });
    await send(cmd, data);
    const res = await Promise.race([wait, sleep(timeoutMs).then(() => null)]);
    if (pending && pending.cmd === wantResp) pending = null; // limpa em timeout
    return res; // { cmd, data } ou null
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
    if (!navigator.bluetooth) throw new Error("Web Bluetooth indisponível (use Chrome/Edge em HTTPS).");
    const prefixes = (model && model.name_prefixes) || [];
    const filters = prefixes.length
      ? prefixes.map((p) => ({ namePrefix: p })) : [{ services: [SVC_UUID] }];
    device = await navigator.bluetooth.requestDevice({ filters, optionalServices: [SVC_UUID] });
    const server = await device.gatt.connect();
    const svc = await server.getPrimaryService(SVC_UUID);
    characteristic = await svc.getCharacteristic(CHAR_UUID);
    await characteristic.startNotifications();
    characteristic.addEventListener("characteristicvaluechanged", onNotify);
    device.addEventListener("gattserverdisconnected", () => { characteristic = null; });
    // Pacote inicial de conexão (raw, prefixo 0x03 — igual ao firmware/niimblue).
    await writeRaw(new Uint8Array([0x03, 0x55, 0x55, 0xc1, 0x01, 0x01, 0xc1, 0xaa, 0xaa]));
    await sleep(200);
  }

  // ── Bitmap: imagem → linhas empacotadas MSB-first (1 = preto) ───────────────
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

  // Bitmap linha-a-linha agrupando linhas idênticas (run-length), idêntico ao
  // nimSendImage() do firmware: 0x84 (vazia) / 0x85 (com pixels).
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

  // ── Sequência de impressão de uma etiqueta (protocolo V4) ───────────────────
  async function printOnePacked(model, size, buf, stride, onProgress) {
    const W = size.w_px, H = size.h_px;
    onProgress && onProgress("configurando…");
    await sendWait(0x21, [model.density], 0x31, 1000);                       // SetDensity
    await sendWait(0x23, [model.label_type], 0x33, 1000);                   // SetLabelType
    await sendWait(0x01, [0, 1, 0, 0, 0, 0, 0, model.speed, 0], 0x02, 2000); // PrintStart

    await send(0xa3, [0x01]); await sleep(30);                               // PrintStatus (one-way)
    await sendWait(0x13, [
      (H >> 8) & 0xff, H & 0xff, (W >> 8) & 0xff, W & 0xff,
      0, 1, 0, 0, 0, 0, 0, 0, 0,
    ], 0x14, 2000);                                                          // SetPageSize

    onProgress && onProgress("enviando imagem…");
    await sendImage(buf, H, stride);
    await sendWait(0xe3, [0x01], 0xe4, 3000);                                // PrintEnd página

    // Poll até a página concluir — sem isto o PrintEnd corta a etiqueta no meio.
    onProgress && onProgress("imprimindo…");
    const t0 = Date.now();
    while (Date.now() - t0 < 25000) {
      const st = await getPrintStatus(900);
      if (st) { onProgress && onProgress(`imprimindo… ${st.print}%`); if (st.page >= 1) break; }
      await sleep(250);
    }
    await sendWait(0xf3, [0x01], 0xf4, 2500);                                // PrintEnd
  }

  async function printImage(url, opts) {
    opts = opts || {};
    const { model, size, onProgress } = opts;
    onProgress && onProgress("conectando…");
    await connect(model);
    const { buf, stride } = await imageToPacked(url, size.w_px, size.h_px);
    await printOnePacked(model, size, buf, stride, onProgress);
    onProgress && onProgress("ok");
  }

  async function printBatch(urls, opts) {
    opts = opts || {};
    const { model, size, onProgress } = opts;
    onProgress && onProgress("conectando…");
    await connect(model);
    for (let i = 0; i < urls.length; i++) {
      const tag = `etiqueta ${i + 1}/${urls.length}`;
      onProgress && onProgress(`${tag}…`);
      const { buf, stride } = await imageToPacked(urls[i], size.w_px, size.h_px);
      await printOnePacked(model, size, buf, stride,
        (s) => onProgress && onProgress(`${tag}: ${s}`));
    }
    onProgress && onProgress("ok");
  }

  root.Niimbot = {
    SVC_UUID, CHAR_UUID,
    isSupported: () => !!navigator.bluetooth,
    connect, printImage, printBatch,
  };
})(typeof window !== "undefined" ? window : globalThis);
