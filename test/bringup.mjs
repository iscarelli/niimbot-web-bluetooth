// bringup.mjs — bring-up harness for the browser console (T-017).
//
// Load it from the demo page's console:
//
//     await import("../test/bringup.mjs")
//
// The path is relative ON PURPOSE: it resolves the same on
// http://localhost:8080/demo/index.html and on the GitHub Pages site. It attaches
// `window.bringup` and returns nothing.
//
// ── What this is ────────────────────────────────────────────────────────────────
// Bringing up a new model used to mean pasting a hand-written snippet per round and
// explaining the reading rule in chat, where it was lost afterwards. The B2 Pro and the
// N1 were both brought up that way on 2026-08-14, and three of the N1's four labels went
// to tests that could not distinguish the hypotheses. The tests that DID work are known
// (docs/NOTES.md § "B2 Pro bring-up" and § "N1"); this file makes each of them one call.
//
// ── What this is NOT ────────────────────────────────────────────────────────────
// It is a testing instrument, not a print path, and NO step here concludes that a print
// succeeded. It says what it is about to send, sends it, and then states the reading rule.
// **The paper decides.** A job that acks every command and reports 100 % can still come out
// blank or short (see CLAUDE.md § "The verification that matters is physical"), so nothing
// in this file may be read as confirmation that anything printed.
//
// Zero dependencies, no build step, no framework. It does not touch src/niimbot.js or the
// demo — it only calls the published API (`probe`, `identify`, `connect`, `disconnect`,
// `printImage`, `getStatus`, `printer`, `DEBUG`).

const LOADER = 'await import("../test/bringup.mjs")';

const bringup = {
  // Mutable at runtime — the console is the UI:
  //     bringup.config.task = "b1"; bringup.config.w_px = 96;
  //
  // Every step builds its throwaway `model` from this, exactly as the console snippets
  // did. The point is that a model which is NOT in registry.json can be driven, and that
  // is what makes bring-up possible at all: `assertSelection()` is a deliberate no-op
  // while the connected printer is unidentified (`printerInfo.task == null`), and
  // `connect()` falls back to `acceptAllDevices` when `name_prefixes` is empty — so the
  // chooser can find a printer this project has never heard of. Empty the prefixes when
  // you do not yet know the advertised name:
  //     bringup.config.name_prefixes = []
  config: {
    name_prefixes: ["N1"],
    task: "b1",          // "b1" or "v4" — bringup.task() is the step that decides it
    density: 3,          // 1–5, the scale the official app uses
    label_type: 1,
    speed: 1,
    w_px: 200,           // printhead axis; the feed axis is per step (h_mm / h_px)
  },
};

// ── plumbing ────────────────────────────────────────────────────────────────────

function nb() {
  const N = (typeof window !== "undefined") && window.Niimbot;
  if (!N) {
    throw new Error(
      "window.Niimbot is not loaded. Run this from the demo page's console (demo/index.html), " +
      "which loads src/niimbot.js, then: " + LOADER
    );
  }
  return N;
}

const log = (...a) => console.log("[bringup]", ...a);
const look = (s) => console.log("%c[bringup] LOOK AT: " + s, "font-weight:bold");
const rule = (title, lines) => {
  console.log("[bringup] " + title);
  for (const l of lines) console.log("           • " + l);
};

const h2 = (n) => "0x" + n.toString(16).padStart(2, "0");
const hex = (d) => (d && d.length ? Array.from(d, (b) => b.toString(16).padStart(2, "0")).join(" ") : "(empty)");
const ascii = (d) => Array.from(d, (b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ".")).join("");

// The throwaway model, rebuilt from `config` on every call so edits take effect at once.
function model() {
  const c = bringup.config;
  return {
    name_prefixes: Array.isArray(c.name_prefixes) ? c.name_prefixes : [],
    task: c.task,
    density: c.density,
    label_type: c.label_type,
    speed: c.speed,
  };
}

// EVERY step starts here, and for the printing steps this is not tidiness.
//
// `connect()` RETURNS EARLY when a link is already open, and `b1Handshake()` only runs
// inside `connect()`, only for a `task: "b1"` model. So a step that reuses the connection
// an earlier step left open silently SKIPS the handshake — the one the D110 needs to print
// at all (it acks every setup command and then never starts). That is exactly what
// happened during the N1 bring-up: a console test that identified first and printed second
// skipped the handshake and cost a confusing round (docs/NOTES.md § N1). Dropping the link
// first is what makes each step self-contained.
//
// The cost is that the browser's device chooser opens once per step. That is the price of
// a handshake you can trust, and it is cheaper than a wasted label.
async function freshLink() {
  await nb().disconnect().catch(() => {});
}

// DEBUG on: the discriminators here are wire-level (`0xdb 06`, the page counter, the ack
// opcodes). Without the driver's RX log there is nothing to read but the paper.
function debugOn() {
  const N = nb();
  if (!N.DEBUG) { N.DEBUG = true; log("Niimbot.DEBUG turned on — the wire log is half of every reading below."); }
}

// Build a 1-bit-ish page as a data URL. `printImage()` fetches the URL and thresholds it,
// so a plain canvas is all the driver wants.
function page(w, h, draw) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, w, h);
  g.fillStyle = "#000";
  draw(g);
  return c.toDataURL("image/png");
}

async function print(url, size, copies) {
  const N = nb();
  const m = model();
  log(`sending: task="${m.task}" density=${m.density} label_type=${m.label_type} speed=${m.speed} ` +
      `page=${size.w_px}×${size.h_px} copies=${copies || 1}`);
  await N.printImage(url, {
    model: m, size, copies: copies || 1,
    onProgress: (s) => log("   …", s),
  });
  // Deliberately NOT "printed ok". The driver reports what the printer acknowledged;
  // an ack is not a label. Read the paper.
  log("the driver finished sending. What the printer ACKED is in the log above — the paper is the result.");
}

// ── steps ───────────────────────────────────────────────────────────────────────

const INFO_SUBS = [0x08, 0x0b, 0x0d, 0x0a, 0x07, 0x03, 0x0c, 0x09];

// No labels are spent here. Ask everything that can be asked before printing anything.
bringup.info = async function info() {
  await freshLink();
  debugOn();
  const N = nb();
  look("nothing prints in this step — it only asks the printer questions.");

  const id = await N.identify(model());
  log("identify →", id);
  log("Niimbot.printer →", N.printer);

  // Printhead width, free, when the model answers: 0xDC[03] → 0xDE, third 16-bit field.
  //   M2-H   de: 01 01  01 36  [02 40 = 576]  03 02 01 00
  //   D11_H  de: 04 01  04 1c  [00 90 = 144]  03 02 01 00
  //   B2 Pro de: 02 01  02 0b  [02 40 = 576]  03 02 01 00
  const head = await N.probe(0xdc, [0x03]);
  if (!head) {
    log("dc[03]: no answer at all (timed out). No printhead width from this printer.");
    log("        → bringup.head() is the only way to get it, and it costs one label.");
  } else if (head.cmd === 0x00) {
    log(`dc[03] → cmd 0x00 ${hex(head.data)} — REFUSED.`);
    log("        This model does NOT report its printhead width (the N1 answers exactly this).");
    log("        → bringup.head() is the only way to get it, and it costs one label.");
  } else {
    log(`dc[03] → ${h2(head.cmd)} ${hex(head.data)}`);
    if (head.data.length >= 6) {
      log(`        printhead width = ${(head.data[4] << 8) | head.data[5]} px  (bytes 4-5, big-endian)`);
    } else {
      log("        reply is too short to carry bytes 4-5 — no width decoded from it.");
    }
  }

  for (const sub of INFO_SUBS) {
    const r = await N.probe(0x40, [sub]);
    if (!r) { log(`40[${h2(sub)}] → (no answer)`); continue; }
    log(`40[${h2(sub)}] → ${h2(r.cmd)} ${hex(r.data)}`);
    if (sub === 0x0b) log(`        serial (ASCII) = "${ascii(r.data)}"`);
  }

  let st = null;
  try { st = await N.getStatus(); } catch (e) { log("getStatus() threw:", e && e.message); }
  if (st) log("getStatus() →", st);

  rule("what this tells you:", [
    "a printhead width above is REPORTED BY THE PRINTER — it still deserves a print to corroborate it (the M2-H's 576 vs the 584 that 'reached the edge' is why).",
    "no width reported ⇒ bringup.head() is the only source, and it is one label.",
    "neither this step nor bringup.head() says anything about dpi — that is bringup.dpi().",
  ]);
};

// The numbered ruler that settled the N1. It asks WHERE a mark landed, not whether it fit:
// an absent mark has more than one cause, a present mark at a predicted position has one.
// (Two earlier N1 labels were spent on "did it fit?" tests that were true under BOTH
// hypotheses — docs/NOTES.md § N1.)
bringup.dpi = async function dpi(opts) {
  const o = opts || {};
  const h_mm = Number(o.h_mm);
  if (!(h_mm > 0)) {
    throw new Error('bringup.dpi({ h_mm }) needs the label\'s length along the feed axis, in mm — e.g. bringup.dpi({ h_mm: 50 })');
  }
  await freshLink();
  debugOn();

  // Page height under the 300 dpi HYPOTHESIS (11.811 px/mm). If the printer is really
  // 203 dpi it runs out of label and truncates the ruler, and where it truncates is
  // the measurement.
  const h_px = Math.round(h_mm * 11.811);
  const w_px = bringup.config.w_px | 0;
  const TICK_PX = 55;   // see the comment on the tick below
  let last = null;

  const url = page(w_px, h_px, (g) => {
    g.fillStyle = "#000";
    g.font = "bold 30px monospace";
    g.textBaseline = "top";
    for (let y = 50; y + 38 <= h_px; y += 50) {
      // The tick is 55 px wide, not full width, and that is on purpose: its right end is
      // a free clip probe on the same label. On the N1 the ruler's digits started at
      // x = 62 and three-digit numbers came out as two — an ACCIDENT that bounded the
      // printhead at ≥ ~96 for free. Keeping a 55 px mark keeps that kind of evidence
      // available without ever letting it eat a number.
      g.fillRect(0, y, TICK_PX, 3);
      // x = 2, and BELOW the tick: at 30 px monospace a three-digit number spans ~51 px,
      // so it ends near x = 53 and cannot be clipped by any plausible head, and the tick
      // never overlaps it. The number must survive — it IS the reading.
      g.fillText(String(y), 2, y + 5);
      last = y;
    }
  });

  look(`the LAST tick number that comes out on the paper. The page asks for ${h_px} rows (${h_mm} mm at 300 dpi), last tick drawn = ${last}.`);
  await print(url, { w_px, h_px }, 1);
  rule("how to read it:", [
    `the last number printed, divided by ${h_mm} (h_mm), is px/mm — 7.99 = 203 dpi, 11.81 = 300 dpi.`,
    "also note WHERE that number sits down the label: a number that lands at ~90 % of the label is a position, not a guess about fit.",
    "if every tick printed and there is blank label left below, the page was shorter than the printable area — rerun with a larger h_mm.",
    "a missing mark has several possible causes; a present mark at a measured position has one. Read the numbers that ARE there.",
  ]);
};

// One label, and it bounds the printhead from both sides at once.
bringup.head = async function head(opts) {
  const o = opts || {};
  const widths = (o.widths && o.widths.length) ? o.widths.slice() : [80, 96, 104, 112, 120];
  await freshLink();
  debugOn();

  const BAND = 34, GAP = 12;
  const w_px = Math.max(bringup.config.w_px | 0, ...widths);
  const h_px = widths.length * (BAND + GAP);

  const url = page(w_px, h_px, (g) => {
    widths.forEach((w, i) => {
      const y = i * (BAND + GAP);
      g.fillStyle = "#000";
      g.fillRect(0, y, w, BAND);
      // The label goes INSIDE the band, in white, hard against the left edge — so a band
      // stays identifiable even when its right end is clipped off.
      g.fillStyle = "#fff";
      g.font = "bold 22px monospace";
      g.textBaseline = "top";
      g.fillText(String(w), 4, y + 6);
    });
  });

  look(`where each band ENDS on the right. Bands requested (top to bottom): ${widths.join(", ")} px.`);
  await print(url, { w_px, h_px }, 1);
  rule("how to read it:", [
    "bands that end at the SAME place are both clipped ⇒ the head is ≤ the smallest of those widths.",
    "the largest band that is visibly NARROWER than the rest is not clipped ⇒ the head is > that width.",
    "the two bounds meet at a number. Corroboration, not proof: printheads here have been multiples of 8 (the row stride) — the D110 and the N1 both landed on 96.",
    "one reading of 'how wide the black came out' would convert a ruler into a number and hide its own error; two bounds from opposite sides cannot both be wrong in the same direction.",
  ]);
};

// Does this model print every page of a multi-page job, or only the first (the D110)?
bringup.copies = async function copies(opts) {
  const o = opts || {};
  const n = o.n == null ? 3 : Math.max(1, o.n | 0);
  const w_px = bringup.config.w_px | 0;
  const h_px = o.h_px == null ? 120 : o.h_px | 0;
  await freshLink();
  debugOn();

  const url = page(w_px, h_px, (g) => {
    g.strokeStyle = "#000";
    g.lineWidth = 8;
    g.beginPath();
    g.moveTo(6, 6); g.lineTo(w_px - 6, h_px - 6);
    g.moveTo(w_px - 6, 6); g.lineTo(6, h_px - 6);
    g.stroke();
  });

  look(`how many labels come out of the printer. ${n} copies of one page were requested.`);
  await print(url, { w_px, h_px }, n);
  rule("how to read it:", [
    `${n} labels ⇒ no pagesPerJob cap on this model, and that ABSENCE is now measured instead of assumed.`,
    "1 label ⇒ pagesPerJob: 1, like the D110 — which acks every command, counts to 1 and prints one label.",
    "count the LABELS, not the log lines: the D110's failure looked perfect on the wire.",
  ]);
};

// Is the configured `task` the one this printer speaks? One small block, once.
bringup.task = async function task(opts) {
  const o = opts || {};
  const w_px = bringup.config.w_px | 0;
  const h_px = o.h_px == null ? 120 : o.h_px | 0;
  await freshLink();
  debugOn();

  const url = page(w_px, h_px, (g) => {
    g.strokeStyle = "#000";
    g.lineWidth = 8;
    g.beginPath();
    g.moveTo(6, 6); g.lineTo(w_px - 6, h_px - 6);
    g.moveTo(w_px - 6, 6); g.lineTo(6, h_px - 6);
    g.stroke();
  });

  look(`the RESPONSE OPCODES in the log, not the paper. Driving as task="${bringup.config.task}".`);
  await print(url, { w_px, h_px }, 1);
  rule("how to read it:", [
    'if the 13-byte SetPageSize and PageEnd each drew `0xdb 06` and no `0x14`/`0xe4` came back, the framing is right and the TASK is wrong.',
    'in that case: set `bringup.config.task = "b1"` (or "v4", whichever you did not just try) and run bringup.task() again yourself.',
    '`0xdb 06` is a two-model signature now (D110 and N1), not a one-off quirk.',
    "if instead every command acked and the page counter reached 1 at 100 %/100 % with PrintEnd `0xf3`→`0xf4`, the task framing was accepted — what came out on paper is a separate question.",
  ]);
  // NO auto-retry, on purpose: firing a second job at a printer that just refused one is
  // how its state gets confused, and then neither run means anything.
  log("this step never retries by itself — change bringup.config.task and call it again.");
};

bringup.help = function help() {
  console.log("[bringup] steps:");
  console.log("           • bringup.info()                 — no labels: ids, 0x40 info reads, printhead width if reported, getStatus()");
  console.log("           • bringup.dpi({ h_mm })          — 1 label:  numbered ruler; the last number printed ÷ h_mm is px/mm");
  console.log("           • bringup.head({ widths })       — 1 label:  stacked bands, default [80,96,104,112,120]; bounds the head from both sides");
  console.log("           • bringup.copies({ n = 3 })      — n labels: does a multi-page job print every page, or only page 1?");
  console.log("           • bringup.task({ h_px })         — 1 label:  is config.task the task this printer speaks? (read the opcodes)");
  console.log("           • bringup.help()                 — this");
  console.log("[bringup] every step drops the link first (see freshLink) so the b1 handshake cannot be skipped;");
  console.log("           the device chooser therefore opens once per step.");
  console.log("[bringup] no step decides whether a print SUCCEEDED. They send, and say what to look for.");
  console.log("[bringup] current config:", JSON.parse(JSON.stringify(bringup.config)));
  console.log("[bringup] loader:", LOADER);
};

if (typeof window !== "undefined") {
  window.bringup = bringup;
  log("ready — bringup.help() lists the steps. Loader: " + LOADER);
} else {
  console.log("[bringup] no window — this harness runs in the demo page's console, not in Node.");
}
