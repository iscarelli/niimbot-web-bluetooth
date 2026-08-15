# Tasks

Strict execution order — always take the **topmost** open task. Retiring a task
means removing it here **and** logging the change under `## [Unreleased]` in
`CHANGELOG.md` (repo root), plus closing its Vikunja mirror card.

Read `CLAUDE.md` first — especially *The verification that matters is physical*.
No task below may claim a print path works; each is verifiable without a printer,
and hardware confirmation is the maintainer's separate step.

## Active

## [ ] T-013  Niimbot B2 Pro support (model id 6912)
Why:     the B2 Pro was brought up on real hardware 2026-08-14 and printed end to end;
         the driver still reports it as `unknown (id 6912)` and the demo cannot select it.
Vikunja: 996
Files:   src/niimbot.js, registry.json, README.md, CHANGELOG.md
Do:
  Everything below is MEASURED on hardware (macOS/Chrome, 2026-08-14, capture in
  `docs/NOTES.md` → *B2 Pro bring-up*). Do not "improve" any value by inference.

  1. `src/niimbot.js`, `MODEL_IDS` (grep the name, the line moves — currently ~306):
     add, keeping the table's existing ordering style and alignment:

       6912: { label: "Niimbot B2 Pro", task: "v4", dpi: 300, paced: false, bundle: false },

     Above it write a comment block, in the style of the `528` and `2304` entries,
     recording exactly this and no more:
       - id 6912 (`0x1B00`), advertised name e.g. `B2 Pro-I304050285`, protocol 5.
       - `task: "v4"` is MEASURED: `0x21→0x31`, `0x23→0x33`, `0x01→0x02`, the 13-byte
         `SetPageSize 0x13→0x14` and `PageEnd 0xe3→0xe4` all acked, and `PrintEnd
         0xf3→0xf4` closed the job. None of the v4-specific commands went silent (that
         silence is the D110's tell for a wrong task).
       - `dpi: 300` is MEASURED against the label itself, not a datasheet: a 354 px tall
         block filled a 30 mm label exactly and left ~20 mm white beside a 354 px wide
         block. At 203 dpi the same block would have been 44 mm and overrun the label.
       - No `pagesPerJob`, and that absence is MEASURED: `copies: 3` printed three
         labels with the printer's counter stepping page 1 → 2 → 3.
       - `paced: false` is NOT a measurement — it is the absence of one. The capture ran
         `paced` only because `IS_MAC` forces it; unpaced was never tried on this unit.
         `false` is chosen over `true` because the field's ONLY effect is
         `warnOverrideVsModel()`, whose text asserts the model "NEEDS pacing … it drops
         rows on an unpaced burst" — a claim nobody here has evidence for on this model.
         Say that in the comment so the next person does not read `false` as measured.
       - `bundle: false` is the conservative default, never measured — same standing as
         the `528` entry.

  2. `registry.json`, `models`: add a `b2pro` entry after `b1pro`:
       label "Niimbot B2 Pro", id 6912, dpi 300, protocol "v4", task "v4",
       density 3, label_type 1, speed 1, name_prefixes ["B2"]
     `density`/`label_type` are the values the printer ACCEPTED (`0x31`, `0x33` acked),
     not values compared against alternatives — say so in `_note`, as the `d110` entry
     does. `name_prefixes: ["B2"]` matches the advertised `B2 Pro-…`.

  3. `registry.json`, `sizes`: add `T50x30_b2pro` — code "T50*30", w_mm 50, h_mm 30,
     w_px 576, h_px 354, margin 10, dpi 300. `_note` must record that `w_px` 576 is the
     printhead width the printer REPORTS ITSELF via `probe(0xDC, [0x03])` (reply `de`
     bytes 4-5 = `02 40`), and that 576 px printed edge to edge on a 50 mm label — two
     independent sources agreeing. `h_px` 354 is measured: 354 rows filled 30 mm exactly.
     A third 300 dpi 50×30 entry is deliberate; the registry already ships `T50x30` (584,
     B1 Pro) and `T50x30_m2h` (567, M2-H) for the same reason.

  4. `README.md`, purely factual updates to existing content — do not restructure:
       - line ~13: add **B2 Pro** to the validated-hardware list.
       - the model table (~line 50): add a `**Niimbot B2 Pro** | v4 | 300 | 6912 |
         ✅ Validated on real hardware` row.
       - the 50×30 width table (~line 90) and the sizes table (~line 123): add the
         `T50x30_b2pro` rows (B2 Pro, 576, 50 × 30, 300 dpi, 576 × 354).
     If any other README sentence becomes false, fix it; if a fix needs real rewriting
     rather than a fact swap, leave it and FLAG it in your report for the planner.

  5. `CHANGELOG.md`: one bullet under `## [Unreleased]` → `### Added`, naming T-013.
     Do NOT bump the version in `package.json` or `VERSION` — releasing is the
     maintainer's step.
Verify:
  - `node --check src/niimbot.js`
  - `node -e "const r=require('./registry.json'); const m=r.models.b2pro, s=r.sizes.T50x30_b2pro;
     if(m.id!==6912||m.task!=='v4'||m.dpi!==300) throw new Error('b2pro model wrong');
     if(s.w_px!==576||s.h_px!==354||s.dpi!==300) throw new Error('T50x30_b2pro wrong');
     console.log('registry ok')"`
  - `node test/label-size.test.js` and `node test/one-page-per-job.test.js` still pass
    (the latter guards the D110 `pagesPerJob` split — the B2 Pro must NOT acquire one).
  - Confirm by inspection that `MODEL_IDS[6912]` has no `pagesPerJob` key.
  This task adds data and documentation only; it changes no print path, so the mechanical
  gates above are the whole verification. The hardware run that justifies it already
  happened — do not claim to have repeated it.
