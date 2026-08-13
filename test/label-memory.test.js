/* Harness: NiimbotLabelMemory — barcode → { size, colour, … } storage.
 *
 * No dependencies, no runner: `node test/label-memory.test.js`. Exits non-zero on
 * failure. NO PRINTER AND NO BROWSER: storage is injected, which is the reason the
 * `storage` parameter exists.
 *
 * The case that matters most is (e): a storage that throws. This module sits next to a
 * print path that must keep working, so a full disk or Safari private mode has to cost
 * the memory and nothing else. It is asserted on its own rather than folded into a
 * generic try/catch test.
 */
"use strict";
const assert = require("node:assert/strict");

require("../src/label-memory.js");
const { create } = globalThis.NiimbotLabelMemory;

// A localStorage-shaped fake. `failOnSet` makes setItem throw the way a real one does
// when the quota is gone or storage is blocked.
function fakeStorage(initial) {
  const m = new Map(Object.entries(initial || {}));
  return {
    failOnSet: false,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem(k, v) {
      if (this.failOnSet) throw new Error("QuotaExceededError (simulated)");
      m.set(k, String(v));
    },
    removeItem: (k) => { m.delete(k); },
    _dump: () => Object.fromEntries(m),
  };
}

let failures = 0;
function ok(name, fn) {
  try { fn(); console.log("ok  " + name); }
  catch (e) { failures++; console.error("FAIL " + name + "\n     " + e.message); }
}

ok("(0) `key` is required — no default, so two apps on one origin cannot collide", () => {
  assert.throws(() => create({}), /key. is required/);
  assert.throws(() => create({ key: "" }), /key. is required/);
});

// (a) round-trip
ok("(a) remember → recall → forget", () => {
  const mem = create({ key: "k", storage: fakeStorage() });
  assert.equal(mem.remember("111", { size: "T50x30" }), true);
  assert.deepEqual(mem.recall("111"), { size: "T50x30" });
  assert.equal(mem.forget("111"), true);
  assert.equal(mem.recall("111"), null);
  assert.equal(mem.recall(""), null);
  assert.equal(mem.recall(undefined), null);
});

// (b) THE collision the required `key` exists to prevent: two apps, one origin.
ok("(b) two keys over ONE storage do not see each other", () => {
  const store = fakeStorage();
  const a = create({ key: "appA:sizes", storage: store });
  const b = create({ key: "appB:sizes", storage: store });
  a.remember("111", "T50x30");
  b.remember("111", "T30x45");
  assert.deepEqual(a.recall("111"), { size: "T50x30" });
  assert.deepEqual(b.recall("111"), { size: "T30x45" });
});

// (c) seed fills gaps only — hand-typed must not overwrite what a real print taught.
ok("(c) seed() default fills gaps only and returns the count written", () => {
  const mem = create({ key: "k", storage: fakeStorage() });
  mem.remember("111", { size: "LEARNED" });
  const n = mem.seed({ "111": { size: "TYPED" }, "222": { size: "NEW" }, "333": "SHORTHAND" });
  assert.equal(n, 2, "only the two missing barcodes are written");
  assert.deepEqual(mem.recall("111"), { size: "LEARNED" }, "measured survives hand-typed");
  assert.deepEqual(mem.recall("222"), { size: "NEW" });
  assert.deepEqual(mem.recall("333"), { size: "SHORTHAND" });
  assert.equal(mem.seed(null), 0);
  assert.equal(mem.seed({}), 0);
});

// (d) the deliberate reset
ok("(d) seed({ overwrite: true }) replaces an existing entry", () => {
  const mem = create({ key: "k", storage: fakeStorage() });
  mem.remember("111", { size: "LEARNED" });
  assert.equal(mem.seed({ "111": { size: "TYPED" } }, { overwrite: true }), 1);
  assert.deepEqual(mem.recall("111"), { size: "TYPED" });
});

// (e) THE one that protects the print path.
ok("(e) a storage whose setItem throws: remember returns false and does NOT throw", () => {
  const store = fakeStorage();
  const mem = create({ key: "k", storage: store });
  mem.remember("111", { size: "T50x30" });
  store.failOnSet = true;
  let threw = false;
  let result;
  try { result = mem.remember("222", { size: "T30x45" }); } catch (e) { threw = true; }
  assert.equal(threw, false, "a full disk must never throw into the caller");
  assert.equal(result, false, "and it must say it failed rather than pretend");
  assert.deepEqual(mem.recall("111"), { size: "T50x30" }, "reads still work after a failed write");
  assert.equal(mem.recall("222"), null);
});

ok("(e2) a missing storage entirely degrades to empty, never throws", () => {
  const mem = create({ key: "k", storage: null });
  assert.equal(mem.remember("111", "T50x30"), false);
  assert.equal(mem.recall("111"), null);
  assert.deepEqual(mem.all(), {});
});

// (f) corrupt data
ok("(f) corrupt JSON and a stored non-object read back as empty", () => {
  for (const junk of ["not json", "[1,2]", "null", "42", '"a string"']) {
    const mem = create({ key: "k", storage: fakeStorage({ k: junk }) });
    assert.deepEqual(mem.all(), {}, "junk: " + junk);
    assert.equal(mem.recall("111"), null);
  }
});

// (g) compatibility with data already on a device, plus arbitrary app keys.
ok("(g) a stored bare string reads as { size }, and extra app keys survive", () => {
  // Exactly the shape a maintainer device already holds.
  const store = fakeStorage({ "niimbot-demo:size-by-barcode": '{"11262111":"T50x30"}' });
  const mem = create({ key: "niimbot-demo:size-by-barcode", storage: store });
  assert.deepEqual(mem.recall("11262111"), { size: "T50x30" }, "old bare string is normalised on read");
  assert.deepEqual(mem.all(), { "11262111": { size: "T50x30" } });

  // and it is NOT rewritten behind the user's back
  assert.equal(store.getItem("niimbot-demo:size-by-barcode"), '{"11262111":"T50x30"}',
    "reading must not rewrite storage");

  mem.remember("6975746632324", { size: "T30x45", color: "white", myOwnField: 7 });
  const rec = mem.recall("6975746632324");
  assert.equal(rec.color, "white");
  assert.equal(rec.myOwnField, 7, "the module owns the storage, not the vocabulary");
  assert.deepEqual(mem.recall("11262111"), { size: "T50x30" }, "the old entry is untouched");
});

ok("(h) a record without a usable `size` is refused rather than stored", () => {
  const mem = create({ key: "k", storage: fakeStorage() });
  assert.equal(mem.remember("111", {}), false);
  assert.equal(mem.remember("111", { color: "red" }), false);
  assert.equal(mem.remember("111", ""), false);
  assert.equal(mem.remember("", { size: "T50x30" }), false);
  assert.equal(mem.recall("111"), null);
});

console.log(failures
  ? `\nFAILED — ${failures} case(s).`
  : "\nPASS — storage round-trips, keys are isolated, seeded data never overwrites what a\n       print taught, and a failing storage costs the memory and nothing else.\n       NO PRINTER: this measures storage behaviour, not printing.");
process.exit(failures ? 1 : 0);
