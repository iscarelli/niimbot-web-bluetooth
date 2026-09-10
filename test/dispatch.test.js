/* Harness: the notification dispatcher's waiter queue (T-035).
 *
 * No dependencies, no runner: `node test/dispatch.test.js`. Exits non-zero on failure.
 * NO PRINTER IS INVOLVED — nothing here opens a BLE connection.
 *
 * T-035 replaced the single `pending` slot that sendWait()/getPrintStatus() shared
 * with a queue (`pendingQueue`) of `{ cmd, resolve }` waiters, so that a future caller
 * can register more than one wait at a time without the second overwriting the first.
 * It is a refactor with NO behaviour change: no print path sends anything in parallel
 * yet, so every real caller today still registers, awaits, and clears one waiter
 * before the next exists. That means there is no PUBLIC entry point that can put two
 * waiters in the queue at once to exercise it — this harness reaches the dispatcher
 * directly through `Niimbot._dispatch` (registerWait/clearWait/onNotify, plus the
 * queue and lastUnsolicited for inspection), which is not published API and exists
 * only so this queue can be tested ahead of anything actually using its capacity.
 *
 * `globalThis.navigator` MUST exist before src/niimbot.js loads (see CLAUDE.md).
 */
"use strict";
const assert = require("node:assert/strict");

Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: {
    platform: "Win32",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    bluetooth: { requestDevice: async () => { throw new Error("not used by this harness"); } },
  },
});

require("../src/niimbot.js");
const Niimbot = globalThis.Niimbot;
const { registerWait, clearWait, onNotify, pendingQueue } = Niimbot._dispatch;

// Build the same V4 frame the driver parses in onNotify: [0x55,0x55,cmd,len,...data,crc,0xAA,0xAA].
function frame(cmd, data) {
  data = data || [];
  const pkt = new Uint8Array(7 + data.length);
  pkt[0] = 0x55; pkt[1] = 0x55; pkt[2] = cmd; pkt[3] = data.length;
  let crc = cmd ^ data.length;
  for (let i = 0; i < data.length; i++) { pkt[4 + i] = data[i]; crc ^= data[i]; }
  pkt[4 + data.length] = crc & 0xff;
  pkt[5 + data.length] = 0xaa; pkt[6 + data.length] = 0xaa;
  return new DataView(pkt.buffer);
}
function deliver(cmd, data) { onNotify({ target: { value: frame(cmd, data) } }); }

let failures = 0;
function ok(name, fn) {
  try { fn(); console.log("ok  " + name); }
  catch (e) { failures++; console.error("FAIL " + name + "\n     " + (e && e.message)); }
}

(() => {
  // ── Two simultaneous waits of DIFFERENT opcodes, resolved out of order ────────
  ok("(1) two waiters for different opcodes each get their own reply, in either order", () => {
    let a = null, b = null;
    const entryA = registerWait(0x02, (r) => { a = r; });
    const entryB = registerWait(0x04, (r) => { b = r; });
    assert.equal(pendingQueue.length, 2, "both waiters must be registered");

    // The SECOND-registered opcode answers FIRST.
    deliver(0x04, [0x09]);
    assert.deepEqual(b, { cmd: 0x04, data: [0x09] }, "waiter B must resolve on its own opcode");
    assert.equal(a, null, "waiter A must NOT have resolved yet");
    assert.equal(pendingQueue.length, 1, "only B's entry should have been removed");
    assert.equal(pendingQueue.indexOf(entryA), 0, "A's entry must still be queued");

    deliver(0x02, [0x01]);
    assert.deepEqual(a, { cmd: 0x02, data: [0x01] }, "waiter A must resolve once its opcode arrives");
    assert.equal(pendingQueue.length, 0, "the queue must be empty once both resolved");
    void entryB;
  });

  // ── A wait that times out does not take down another outstanding wait ─────────
  ok("(2) clearing a timed-out waiter leaves the other waiter (and its later reply) intact", () => {
    let a = "untouched", b = null;
    const entryA = registerWait(0x10, () => { a = "resolved"; });
    registerWait(0x20, (r) => { b = r; });
    assert.equal(pendingQueue.length, 2);

    // Simulate sendWait's timeout path for A only.
    clearWait(entryA);
    assert.equal(pendingQueue.length, 1, "clearing A must remove exactly one entry");
    assert.equal(a, "untouched", "A's resolve must never fire once cleared");

    // B, registered before A timed out, must still resolve normally.
    deliver(0x20, [0x07]);
    assert.deepEqual(b, { cmd: 0x20, data: [0x07] });
    assert.equal(pendingQueue.length, 0);

    // A late reply for the opcode A was waiting on, arriving AFTER the timeout
    // cleared it, must not find anything to resolve (see case 3: it becomes
    // lastUnsolicited instead) and must not throw.
    assert.doesNotThrow(() => deliver(0x10, [0xff]));
    assert.equal(a, "untouched", "a late reply must not resolve a cleared waiter");
  });

  // ── A response with no registered waiter falls to lastUnsolicited ─────────────
  ok("(3) an unmatched response is recorded as lastUnsolicited and resolves nothing", () => {
    assert.equal(pendingQueue.length, 0, "queue must be empty for this case");
    deliver(0xb3, [0x00, 0x02, 0x64, 0x00]);
    assert.deepEqual(Niimbot._dispatch.lastUnsolicited, { cmd: 0xb3, data: [0x00, 0x02, 0x64, 0x00] });
  });

  // ── Two waits of the SAME opcode resolve in the order they were registered ────
  ok("(4) same-opcode waiters resolve FIFO, first-registered first", () => {
    const order = [];
    registerWait(0x99, (r) => order.push(["first", r]));
    registerWait(0x99, (r) => order.push(["second", r]));
    assert.equal(pendingQueue.length, 2);

    deliver(0x99, [0x01]);
    assert.equal(order.length, 1);
    assert.equal(order[0][0], "first", "the first-registered waiter must resolve on the first reply");
    assert.deepEqual(order[0][1], { cmd: 0x99, data: [0x01] });
    assert.equal(pendingQueue.length, 1, "the second waiter must still be queued");

    deliver(0x99, [0x02]);
    assert.equal(order.length, 2);
    assert.equal(order[1][0], "second", "the second-registered waiter must resolve on the second reply");
    assert.deepEqual(order[1][1], { cmd: 0x99, data: [0x02] });
    assert.equal(pendingQueue.length, 0);
  });

  // ── `cmd === null` still matches ANY opcode (the handshake's existing behaviour) ─
  ok("(5) a null-cmd waiter (\"any opcode\") matches whatever arrives first, as today", () => {
    let got = null;
    registerWait(null, (r) => { got = r; });
    deliver(0x77, [0x0a]);
    assert.deepEqual(got, { cmd: 0x77, data: [0x0a] });
    assert.equal(pendingQueue.length, 0);
  });

  console.log(failures
    ? `\nFAILED — ${failures} case(s).`
    : "\nPASS — the waiter queue resolves each entry by its own opcode, in either\n"
      + "       registration order, without one waiter's timeout or reply disturbing\n"
      + "       another. NO PRINTER RAN THIS: it is a refactor with capacity nothing\n"
      + "       uses yet, not proof that any concurrent print path works.");
  process.exit(failures ? 1 : 0);
})();
