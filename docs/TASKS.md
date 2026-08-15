# Tasks

Strict execution order — always take the **topmost** open task. Retiring a task
means removing it here **and** logging the change under `## [Unreleased]` in
`CHANGELOG.md` (repo root), plus closing its Vikunja mirror card.

Read `CLAUDE.md` first — especially *The verification that matters is physical*.
No task below may claim a print path works; each is verifiable without a printer,
and hardware confirmation is the maintainer's separate step.

## Active

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

