# Tasks

Strict execution order — always take the **topmost** open task. Retiring a task
means removing it here **and** logging the change under `## [Unreleased]` in
`CHANGELOG.md` (repo root), plus closing its Vikunja mirror card.

Read `CLAUDE.md` first — especially *The verification that matters is physical*.
No task below may claim a print path works; each is verifiable without a printer,
and hardware confirmation is the maintainer's separate step.

## Active

## [ ] T-040  Add the D110_M (model id 2320, 203 dpi) and its two round-corner sizes
Why:     A real D110_M connects as "unknown (id 2320)", and the demo sized its rolls at 300 dpi / 584 px because the Model selector was left on the B1 Pro.
Vikunja: 1926
Files:   src/niimbot.js, registry.json, demo/index.html, README.md, docs/protocol-v4.md, CHANGELOG.md
Do:
  Facts (state each one's standing in the comments/_note — nothing here was printed):
  - Seen on hardware 2026-10-07 (a real user's printer, connect + status only, NO print):
    advertised name "D110_M-H822021655"; 0x40[0x08] answered `09 10` = model id 2320;
    0xb5 version bytes `03 01` = 301 → protocol 4; heartbeat 11 bytes (advanced2/11).
  - Upstream claims, NOT measured here (niimbluelib src/printer_models.ts and
    src/print_tasks/index.ts, read 2026-10-07): D110_M id [2320], dpi 203,
    printheadPixels 96, density 1-5 default 3; task: D110_M at protocol v4 uses
    `D110M_V4` (= this driver's "v4"), otherwise `B1`. This unit reports protocol 4,
    so task "v4". Note the plain D110 (2304) needed "b1" here — do NOT copy the d110 entry.
  1. src/niimbot.js MODEL_IDS: add
     `2320: { label: "Niimbot D110_M", task: "v4", dpi: 203, paced: true, bundle: false, pagesPerJob: 1, batteryScale: "enum" }`
     with a comment block in the style of its neighbours saying the above, and that
     paced/bundle/pagesPerJob are CONSERVATIVE choices copied from the D110's failure
     modes, not measurements (pagesPerJob 1 because its sibling D110 prints only the
     first page of a multi-page job). First check pagesPerJob is honoured on the "v4"
     path; if it is not, keep the field anyway only if harmless and say so in the report.
     Do not add 2320 to INVERTED_LID_MODELS (lidClosed=true was read with the lid shut).
  2. src/niimbot.js ~line 974 comment: the "v4" line lists "D110M ... 300 dpi" — fix
     it: task is independent of dpi (the D110_M is 203 dpi on "v4").
  3. registry.json models: add "d110m" (label "Niimbot D110_M", id 2320, dpi 203,
     protocol "v4", task "v4", density 3, label_type 1, speed 1, name_prefixes ["D110"])
     with a _note in the style of "d110" saying identified but NOT printed.
     Fix the top `_comment`: it says "(D110M/B1 Pro/B21 Pro)" under v4 implying 300 dpi
     context, and "All models/sizes here are validated on real hardware" becomes false —
     reword so the D110_M and its sizes are explicitly the exception.
  4. registry.json sizes (both rolls are round-corner, white; the user registered them
     lying down as 50×15 and 40×12 — the D110 feeds them standing, short side across
     the head). No `code` (not known), no `offset_y_px` (not measured — say so, and say
     do NOT copy T15x50's -2: offsets are per model):
     - "T15x50_d110m": label "15 × 50 mm round corner (D110_M)", w_mm 15, h_mm 50,
       w_px 96 (PRINTHEAD, per upstream; 15 mm would be 120), h_px 400, margin 6, dpi 203.
     - "T12x40_d110m": label "12 × 40 mm round corner (D110_M)", w_mm 12, h_mm 40,
       w_px 96, h_px 320, margin 6, dpi 203.
  5. demo/index.html PRINTHEAD_PX: add `d110m: 96` and list it in the comment as an
     UPSTREAM value, not measured (the comment separates real from unverified widths).
  6. README.md (lines ~15 and ~90, and the "These seven are in registry.json" sentence)
     and docs/protocol-v4.md:5: remove the D110_M from the "300 dpi" wording; say it is
     in the registry as identified-not-printed, 203 dpi, task "v4".
  7. CHANGELOG.md `## [Unreleased]`: one Added entry. Do not bump the version.
Verify:
  - node --check src/niimbot.js
  - node -e "const r=require('./registry.json');const m=r.models.d110m,a=r.sizes.T15x50_d110m,b=r.sizes.T12x40_d110m;if(m.id!==2320||m.dpi!==203||m.task!=='v4'||a.w_px!==96||a.h_px!==400||b.w_px!==96||b.h_px!==320)throw 1;console.log('ok')"
  - The demo inline-script syntax check from CLAUDE.md (every block returns 0).
  - Every harness in CLAUDE.md's Verify list still passes.
  - grep -n "D110_M\|D110M" README.md docs/protocol-v4.md src/niimbot.js registry.json — no remaining line puts the D110_M at 300 dpi.
  - Hardware confirmation is outstanding (Vikunja 1927) — say so in the report.
