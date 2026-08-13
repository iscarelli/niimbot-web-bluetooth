/* Harness: NiimbotLabelSize.sizeFromMm() — millimetres → SetPageSize pixels.
 *
 * No dependencies, no runner: `node test/label-size.test.js`. Exits non-zero on failure.
 * NO PRINTER AND NO BROWSER ARE INVOLVED. This is pure arithmetic, which is exactly why
 * it was split out of the demo panel into its own file.
 *
 * The three anchor cases (a, b, c) are NOT numbers invented here: they are the values
 * the project already arrived at independently, in docs/protocol-v4.md:370 and in
 * registry.json. If the helper disagrees with them, the helper is wrong.
 */
"use strict";
const assert = require("node:assert/strict");

require("../src/label-size.js");
const { sizeFromMm, registryEntry } = globalThis.NiimbotLabelSize;

let failures = 0;
function ok(name, fn) {
  try { fn(); console.log("ok  " + name); }
  catch (e) { failures++; console.error("FAIL " + name + "\n     " + e.message); }
}

// (a) 30 × 95 mm cable flag at 300 dpi — docs/protocol-v4.md:370 records 354 × 1122,
//     stride 45. The label (354 px) is well inside the head, so nothing clamps.
ok("(a) 30×95 mm @300dpi matches docs/protocol-v4.md: 354 × 1122, stride 45, no clamp", () => {
  const s = sizeFromMm({ w_mm: 30, h_mm: 95, dpi: 300, printhead_px: 584 });
  assert.equal(s.w_px, 354);
  assert.equal(s.h_px, 1122);
  assert.equal(s.stride, 45);
  assert.equal(s.clamped, false);
});

// (b) 50 × 30 mm at 300 dpi — registry.json T50x30 is 584 × 354. The label alone wants
//     591 px, so the B1 Pro head is the limit and the clamp MUST report itself.
ok("(b) 50×30 mm @300dpi matches registry T50x30: 584 × 354, stride 73, clamped", () => {
  const s = sizeFromMm({ w_mm: 50, h_mm: 30, dpi: 300, printhead_px: 584 });
  assert.equal(s.w_px, 584);
  assert.equal(s.h_px, 354);
  assert.equal(s.stride, 73);
  assert.equal(s.clamped, true);
  assert.equal(s.label_px, 591, "the un-clamped label width is reported so a UI can explain the clamp");
});

// (c) 50 × 30 mm at 203 dpi — registry.json T50x30_b1 is 384 × 240, stride 48.
ok("(c) 50×30 mm @203dpi matches registry T50x30_b1: 384 × 240, stride 48, clamped", () => {
  const s = sizeFromMm({ w_mm: 50, h_mm: 30, dpi: 203, printhead_px: 384 });
  assert.equal(s.w_px, 384);
  assert.equal(s.h_px, 240);
  assert.equal(s.stride, 48);
  assert.equal(s.clamped, true);
});

// (d) stride is ceil(w_px / 8), checked on a width that is NOT a multiple of 8.
ok("(d) stride rounds up: 354 px → 45 bytes, not 44", () => {
  const s = sizeFromMm({ w_mm: 30, h_mm: 30, dpi: 300, printhead_px: 584 });
  assert.equal(s.w_px, 354);
  assert.equal(s.stride, 45);
  assert.equal(Math.ceil(354 / 8), 45);
});

// (e) Rubbish in returns null — never a size object carrying NaN, which would reach the
//     printer as a page-size command and cost a label to discover.
ok("(e) rubbish input returns null, never NaN in a size object", () => {
  const bad = [
    { w_mm: 0, h_mm: 30, dpi: 300 },
    { w_mm: -5, h_mm: 30, dpi: 300 },
    { w_mm: "30", h_mm: 30, dpi: 300 },
    { w_mm: 30, h_mm: NaN, dpi: 300 },
    { w_mm: 30, h_mm: 30, dpi: 0 },
    { w_mm: 30, h_mm: 30, dpi: 300, printhead_px: -1 },
    {},
    null,
  ];
  for (const spec of bad) {
    assert.equal(sizeFromMm(spec), null, "expected null for " + JSON.stringify(spec));
  }
});

// The clamp must be OPTIONAL: an app that does not know the head width still gets the
// label's own geometry rather than nothing.
ok("(f) no printhead_px given → label width, clamped false", () => {
  const s = sizeFromMm({ w_mm: 50, h_mm: 30, dpi: 300 });
  assert.equal(s.w_px, 591);
  assert.equal(s.clamped, false);
});

// registryEntry() exists so an export can be pasted into registry.json unedited.
ok("(g) registryEntry emits registry.json key names", () => {
  const e = registryEntry({ label: "30 × 45+50 mm", w_mm: 30, h_mm: 95, dpi: 300, printhead_px: 584 });
  assert.deepEqual(Object.keys(e).sort(), ["dpi", "h_mm", "h_px", "label", "w_mm", "w_px"]);
  assert.equal(e.w_px, 354);
  assert.equal(e.h_px, 1122);
  assert.equal(registryEntry({ w_mm: 0, h_mm: 1, dpi: 300 }), null);
});

console.log(failures
  ? `\nFAILED — ${failures} case(s).`
  : "\nPASS — geometry matches the numbers already recorded in docs/protocol-v4.md and\n       registry.json. NO PRINTER, NO BROWSER: this is arithmetic, and it proves\n       nothing about how a custom size actually prints on paper.");
process.exit(failures ? 1 : 0);
