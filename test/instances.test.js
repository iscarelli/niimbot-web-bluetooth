/* Harness: Niimbot.create() — one independent driver instance per printer (T-043).
 *
 * No dependencies, no runner: `node test/instances.test.js`. Exits non-zero on failure.
 * NO PRINTER IS INVOLVED — two fake GATT devices answer the handshake. This proves the
 * instances do not share connection state; it says nothing about two real printers
 * printing at once, which is the maintainer's step on hardware.
 *
 * `globalThis.navigator` MUST exist before src/niimbot.js loads (see CLAUDE.md).
 */
"use strict";
const assert = require("node:assert/strict");

function frame(cmd, data) {
  const pkt = new Uint8Array(7 + data.length);
  pkt[0] = 0x55; pkt[1] = 0x55; pkt[2] = cmd; pkt[3] = data.length;
  let crc = cmd ^ data.length;
  for (let i = 0; i < data.length; i++) { pkt[4 + i] = data[i]; crc ^= data[i]; }
  pkt[4 + data.length] = crc & 0xff;
  pkt[5 + data.length] = 0xaa; pkt[6 + data.length] = 0xaa;
  return new DataView(pkt.buffer);
}

// A fake printer: its own characteristic, its own notify listener, its own model id.
function fakePrinter(name, modelIdBytes) {
  const p = { name, notify: null, writes: 0 };
  const deliver = (cmd, data) => p.notify && p.notify({ target: { value: frame(cmd, data) } });
  const handle = (bytes) => {
    p.writes++;
    if (bytes.length < 7 || bytes[0] !== 0x55 || bytes[1] !== 0x55) return;
    const cmd = bytes[2], sub = bytes[4];
    if (cmd === 0xa5) { const d = new Array(13).fill(0); d[11] = 3; deliver(0xb5, d); }
    else if (cmd === 0x40 && sub === 0x08) deliver(0x48, modelIdBytes);
    else if (cmd === 0x40) deliver(0x48, [0x00]);
    else if (cmd === 0xdc) deliver(0xd9, [0x00]);
  };
  const characteristic = {
    properties: { write: true, writeWithoutResponse: true },
    async startNotifications() {},
    addEventListener(type, fn) { if (type === "characteristicvaluechanged") p.notify = fn; },
    async writeValueWithoutResponse(b) { handle(b); },
    async writeValueWithResponse(b) { handle(b); },
  };
  const gatt = {
    connected: false,
    async connect() { this.connected = true; return { getPrimaryService: async () => ({ getCharacteristic: async () => characteristic }) }; },
    disconnect() { this.connected = false; },
  };
  p.device = { name, gatt, addEventListener() {} };
  p.deliver = deliver;
  return p;
}

const printerA = fakePrinter("B1-TEST", [0x10, 0x00]);   // 4096 — B1, paced
const printerB = fakePrinter("M2H-TEST", [0x12, 0x00]);  // 4608 — M2-H, fast
const chooser = [printerA.device, printerB.device];

Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: {
    platform: "Win32",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    bluetooth: { requestDevice: async () => chooser.shift() },
  },
});

require("../src/niimbot.js");
const Niimbot = globalThis.Niimbot;

let failures = 0;
async function ok(name, fn) {
  try { await fn(); console.log("ok  " + name); }
  catch (e) { failures++; console.error("FAIL " + name + "\n     " + (e && e.stack)); }
}

(async () => {
  const MODEL = { name_prefixes: ["X"], task: "b1" };

  await ok("(1) the global keeps its API, and create() makes independent instances with the same API", () => {
    assert.equal(typeof Niimbot.create, "function");
    for (const k of ["connect", "disconnect", "printImage", "printBatch", "readiness", "battery", "getStatus", "identify", "probe", "isSupported"]) {
      assert.equal(typeof Niimbot[k], "function", "default instance lacks " + k);
    }
    const x = Niimbot.create();
    assert.notEqual(x, Niimbot);
    assert.notEqual(x.printImage, Niimbot.printImage);
    for (const k of Object.keys(Niimbot)) if (k !== "create") assert.ok(k in x, "created instance lacks " + k);
  });

  const a = Niimbot.create(), b = Niimbot.create();
  await a.connect(MODEL);
  await b.connect(MODEL);

  await ok("(2) two instances hold two different connections", () => {
    assert.equal(a.printer.modelId, 4096);
    assert.equal(b.printer.modelId, 4608);
    assert.equal(a.DETECTED_WRITE_MODE, "paced");
    assert.equal(b.DETECTED_WRITE_MODE, "fast");
    assert.equal(Niimbot.printer, null, "the default instance never connected");
  });

  await ok("(3) a notification on device A resolves only A's waiter", () => {
    let gotA = null, gotB = null;
    a._dispatch.registerWait(0x02, (r) => { gotA = r; });
    b._dispatch.registerWait(0x02, (r) => { gotB = r; });
    printerA.deliver(0x02, [1]);
    assert.ok(gotA, "A's waiter must resolve");
    assert.equal(gotB, null, "B's waiter must not");
    assert.equal(b._dispatch.pendingQueue.length, 1);
    printerB.deliver(0x02, [2]);
    assert.ok(gotB, "B's waiter resolves on B's own notification");
  });

  await ok("(4) settings are per instance", () => {
    a.PACE_MS = 33;
    assert.equal(a.PACE_MS, 33);
    assert.equal(b.PACE_MS, 10);
    a.WRITE_MODE = "acked";
    assert.equal(b.WRITE_MODE, null);
    assert.equal(b.EFFECTIVE_WRITE_MODE, "fast");
    a.WRITE_MODE = null;
  });

  await ok("(5) disconnect of A leaves B connected", async () => {
    await a.disconnect();
    assert.equal(printerA.device.gatt.connected, false);
    assert.equal(printerB.device.gatt.connected, true);
    assert.equal(a.printer, null);
    assert.equal(b.printer.modelId, 4608);
    const before = printerB.writes;
    await b.connect(MODEL);                 // still connected → no-op, no new handshake
    assert.equal(printerB.writes, before);
  });

  if (failures) { console.error(failures + " failure(s)"); process.exit(1); }
  console.log("all instances tests passed");
})();
