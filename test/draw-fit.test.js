// Headless geometry check for T-021: `drawTest` must fit its text to the label WIDTH,
// not only derive the size from the height.
//
// No printer, no browser, no dependency. It lifts `fitFont` and `drawTest` straight out
// of demo/index.html (the demo has no build step and no module boundary, so the source
// text IS the interface) and runs them against a stub 2D context.
//
// What this proves: the chosen font size measures narrow enough to fit between the
// margins. What it does NOT prove: that the printed label looks right. `measureText`
// here is an approximation of a real font, and only a real print at T14x50 settles the
// appearance — that is the maintainer's step.

const fs = require("fs");
const path = require("path");

const HTML = path.join(__dirname, "..", "demo", "index.html");
const src = fs.readFileSync(HTML, "utf8");

// Pull one top-level `function name(...) { ... }` out of the page by brace matching.
// Naive counting is safe here: every brace in these two functions is balanced, including
// the `${...}` of the template literals.
function extract(name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`function ${name} not found in ${HTML}`);
  let i = src.indexOf("{", start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces while extracting ${name}`);
}

const load = new Function(
  `${extract("fitFont")}\n${extract("drawTest")}\nreturn { fitFont, drawTest };`
);
const { drawTest } = load();

// ~0.55 em per character is close enough for bold sans-serif; the assertion below uses
// the same number, so the test measures the shrink LOGIC, not a font metric.
const PER_CHAR = 0.55;
const measure = (txt, fontPx) => PER_CHAR * fontPx * txt.length;

function stubCanvas() {
  const ctx = {
    font: "",
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    textAlign: "",
    textBaseline: "",
    fontAtFillText: null,
    fillRect() {}, strokeRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
    measureText(txt) { return { width: measure(txt, this.fontPx()) }; },
    fontPx() { return Number(/(\d+(?:\.\d+)?)px/.exec(this.font)[1]); },
    fillText() { this.fontAtFillText = this.font; },
  };
  return { width: 0, height: 0, getContext: () => ctx, ctx };
}

function run(size, text) {
  const c = stubCanvas();
  drawTest(size, text, c, false);
  const px = Number(/(\d+(?:\.\d+)?)px/.exec(c.ctx.fontAtFillText)[1]);
  return { px, width: measure(text, px), canvas: c };
}

let failed = 0;
function assert(ok, msg) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`);
  if (!ok) failed++;
}

// 1. T14x50 — the portrait label that found the bug. 96 px wide, 400 tall: the
//    height-derived start size is round(400 * 0.16) = 64 px, which at 12 characters
//    is ~422 px on a 96 px label. It must come down to fit.
const NARROW = { w_px: 96, h_px: 400, margin: 6 };
const TEXT = "NIIMBOT TEST";
const narrow = run(NARROW, TEXT);
const maxW = NARROW.w_px - 2 * NARROW.margin;
assert(
  narrow.width <= maxW,
  `T14x50: "${TEXT}" at ${narrow.px}px measures ${narrow.width.toFixed(1)} <= ${maxW} px drawable`
);
assert(
  narrow.px < Math.round(NARROW.h_px * 0.16),
  `T14x50: font shrank from the ${Math.round(NARROW.h_px * 0.16)}px start size to ${narrow.px}px`
);
assert(narrow.px > 6, `T14x50: font ${narrow.px}px stayed above the 6px floor`);

// The bug, stated as the check that would have caught it: the OLD code used the start
// size verbatim, and that overflows.
assert(
  measure(TEXT, Math.round(NARROW.h_px * 0.16)) > maxW,
  `regression guard: the unshrunk ${Math.round(NARROW.h_px * 0.16)}px start size really does overflow (${measure(TEXT, Math.round(NARROW.h_px * 0.16)).toFixed(1)} > ${maxW})`
);

// 2. A landscape label must be untouched — the fix may not quietly resize every label.
const WIDE = { w_px: 584, h_px: 354, margin: 10 };
const wide = run(WIDE, TEXT);
assert(
  wide.px === Math.round(WIDE.h_px * 0.16),
  `584x354: font stayed at the unshrunk Math.round(354 * 0.16) = ${Math.round(WIDE.h_px * 0.16)}px (got ${wide.px}px)`
);
assert(
  wide.width <= WIDE.w_px - 2 * WIDE.margin,
  `584x354: "${TEXT}" at ${wide.px}px measures ${wide.width.toFixed(1)} <= ${WIDE.w_px - 2 * WIDE.margin} px drawable`
);

// 3. The canvas is still sized from the registry values, i.e. drawTest still draws.
assert(
  narrow.canvas.width === 96 && narrow.canvas.height === 400,
  `T14x50: canvas sized ${narrow.canvas.width} x ${narrow.canvas.height}`
);

console.log(failed ? `\n${failed} check(s) FAILED` : "\nall checks passed");
process.exit(failed ? 1 : 0);
