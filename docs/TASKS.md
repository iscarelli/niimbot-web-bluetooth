# Tasks

Strict execution order — always take the **topmost** open task. Retiring a task
means removing it here **and** logging the change under `## [Unreleased]` in
`CHANGELOG.md` (repo root), plus closing its Vikunja mirror card.

Read `CLAUDE.md` first — especially *The verification that matters is physical*.
No task below may claim a print path works; each is verifiable without a printer,
and hardware confirmation is the maintainer's separate step.

## Active

## [ ] T-021  `drawTest` clips text sideways on a narrow label
Why:     `drawTest` sizes its font from the height alone — `size.h_px * 0.16`. On the new
         `T14x50` (96 × 400) that is a 64 px font on a 96 px wide canvas, so the text runs
         off both edges with no error at all: you just find part of a word on the paper.
         Found on an N1 on 2026-08-15, on the demo's own "Connect and print" button.
Vikunja: 1003
Files:   demo/index.html, CHANGELOG.md
Do:
  **The fix already exists in this file.** `drawReal`'s `put()` helper shrinks a string
  until it fits `W - 2 * pad`, and the comment above it describes this exact bug ("Width
  clips as silently as height does… you would just find half a word on the paper"). Someone
  already paid for this lesson and applied it in one place only. Do not invent a second
  approach — reuse that one.

  1. `demo/index.html`, `drawTest` (~line 373): the text must fit the canvas WIDTH as well
     as derive from its height. Keep `Math.round(size.h_px * 0.16)` as the STARTING size —
     it is what makes the label look the same on every landscape size — then shrink until
     `measureText(text).width` fits the drawable width, with the same floor `drawReal` uses
     (`fs > 6`). `drawTest` centres its text rather than left-aligning it, so compute the
     drawable width from the same margin it already uses (`size.margin || 10`), not from
     `drawReal`'s `pad`.
     If the shrink-to-fit logic is worth sharing between the two functions, factor it into
     one small helper and use it from both — but only if that comes out genuinely simpler.
     Two call sites is not automatically a reason to abstract; a duplicated four-line loop
     that both sites can read is better than a helper neither site can follow.

  2. The comment at `drawTest`'s neighbour (~line 401) claims sizes as fractions of `h_px`
     "fit every label in the registry without a per-size layout". That is what broke: it
     holds for landscape labels and `T14x50` is the first portrait one (400 tall against
     96 wide). Correct the claim where it is stated — do not delete the reasoning, it
     explains why the layout has no per-size branches, which is still the design.

  3. `CHANGELOG.md`: one bullet under `## [Unreleased]` → `### Fixed`, naming T-021.
     User-visible: the demo's own test print was losing text on the narrowest labels.
Verify:
  - Extract and syntax-check the demo's inline scripts with the python snippet in
    `CLAUDE.md` (§ Verify commands) — every block returns 0. **Syntax gate only.**
  - Headless geometry check, no printer and no browser: this is the assertion that
    actually proves the fix, so do not skip it. In Node, stub a minimal 2D context that
    records the font and returns a plausible `measureText` width (≈ `0.55 * fontPx *
    text.length` is close enough for bold sans), run `drawTest`'s sizing logic against
    `{ w_px: 96, h_px: 400, margin: 6 }` with the text `"NIIMBOT TEST"`, and assert the
    chosen font size yields a measured width ≤ `96 - 2 * 6`. Assert too that a landscape
    size (`{ w_px: 584, h_px: 354, margin: 10 }`) still gets the UNSHRUNK
    `Math.round(354 * 0.16)` = 57 px, so the fix does not quietly change every other label.
    Keep the harness under `test/` per `CLAUDE.md`; name it `test/draw-fit.test.js`.
  - `node --check test/draw-fit.test.js` and run it — it must PASS.
  A real print at `T14x50` through the demo is the maintainer's step and is outstanding.
  Your harness proves the font shrinks; it does not prove the label looks right.

## [ ] T-020  The registry still asserts what `NOTES.md` retracted (M2-H printhead)

## [ ] T-020  The registry still asserts what `NOTES.md` retracted (M2-H printhead)
Why:     `registry.json` says in TWO places that the M2-H head "reaches at least 584".
         `docs/NOTES.md` retracted that on 2026-08-13 — `dc[03]` reports **576**, and the
         8 px gap is 0.68 mm, which hides inside "it printed edge to edge". The retraction
         was written and neither end was updated, so two files now disagree about the same
         printer. Doc that is merely missing makes you grep; doc that is wrong makes you
         trust it and be wrong.
Vikunja: 1002
Files:   registry.json, README.md, CHANGELOG.md
Do:
  1. `registry.json`, `models.m2h._note` and `sizes.T50x30_m2h._note`: both contain the
     phrase "reaches at least 584". Replace the claim in both with what is actually known:
       - the printer REPORTS 576 via `probe(0xDC, [0x03])` (reply `de`, bytes 4-5 =
         `02 40`) — see `docs/NOTES.md` § *The printer reports its own printhead width*;
       - solid black at 584 did print edge to edge on 2026-08-13, and that observation is
         real, but the conclusion drawn from it was too strong: 584 − 576 = 8 px = 0.68 mm,
         well inside what a border can hide on a 50 mm label;
       - the comparison that would settle it — print solid black at 584 and at 576 and see
         whether the bands are identical — has NOT been run. Say so; do not present 576 as
         confirmed on paper when only the report is confirmed.
     Everything else in those notes stays, in particular the reason `w_px` is 567: a
     deliberate ~1.4 mm margin for RIBBON DRIFT, which is unaffected by this correction.
     Do not change `w_px` (567) or any other value — this task fixes prose, not data.

  2. `README.md`, the Troubleshooting table row "Dense / image-heavy labels are slow or
     stall between labels" (~line 571): it ends "for N identical labels use `copies` (one
     upload)". That was already imprecise for the D110 and is now imprecise for two models
     — on any model with `pagesPerJob: 1` (D110, N1) `copies` does NOT mean one upload; the
     driver sends N complete jobs and the image crosses BLE N times. Add that caveat to the
     row. Keep it to one clause; the full explanation lives in the `pagesPerJob` callout.
     If the same claim appears elsewhere in `README.md`, fix it there too.

  3. `CHANGELOG.md`: one bullet under `## [Unreleased]` → `### Fixed`, naming T-020.
Verify:
  - `node -e "const fs=require('fs'); const s=fs.readFileSync('registry.json','utf8');
     if(/reaches at least 584/.test(s)) throw new Error('retracted claim still present');
     const r=JSON.parse(s);
     if(r.sizes.T50x30_m2h.w_px!==567) throw new Error('w_px must stay 567');
     if(!/576/.test(r.models.m2h._note)) throw new Error('m2h note should now cite 576');
     console.log('registry ok')"`
  - `node test/label-size.test.js` passes
  - `node --check src/niimbot.js`
  - By inspection: the ribbon-drift reason for `w_px: 567` survives in both notes. If your
    edit removed it, you traded one wrong doc for another.
  Prose only, no data and no code path. Nothing here is hardware-verifiable, and the
  comparison print the notes now describe as un-run is exactly that — un-run. Do not run
  a claim past it.

