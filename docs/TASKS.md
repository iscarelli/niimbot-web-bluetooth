# Tasks

Strict execution order — always take the **topmost** open task. Retiring a task
means removing it here **and** logging the change under `## [Unreleased]` in
`CHANGELOG.md` (repo root), plus closing its Vikunja mirror card.

Read `CLAUDE.md` first — especially *The verification that matters is physical*.
No task below may claim a print path works; each is verifiable without a printer,
and hardware confirmation is the maintainer's separate step.

## Active

## [ ] T-014  Niimbot N1 support (model id 3586) + repair the identification comment
Why:     the N1 printed end to end on hardware 2026-08-14; the driver reports it as
         `unknown (id 3586)`. The comment block above `MODEL_IDS` is also stale, and this
         task edits exactly that region, so it is the right moment to fix it.
Vikunja: 997
Files:   src/niimbot.js, registry.json, README.md, CHANGELOG.md
Do:
  Measured on hardware (macOS/Chrome, 2026-08-14). The capture and the reasoning are in
  `docs/NOTES.md` → *N1*. Do not re-derive or "correct" any value.

  1. `src/niimbot.js`, `MODEL_IDS`: add after the `6912` entry

       3586: { label: "Niimbot N1", task: "b1", dpi: 203, paced: true, bundle: false },

     with a comment block in the style of the `2304` / `6912` entries recording:
       - id 3586 (`0x0E02`), advertised name e.g. `N1-H324110115`, firmware 4.07.
       - `task: "b1"` is MEASURED, and measured the hard way: driven as `v4` the printer
         acked `0x21→0x31`, `0x23→0x33` and `PrintStart 9b 0x01→0x02`, then answered the
         13-byte `SetPageSize` and `PageEnd` with `0xdb 06` and nothing else — the same
         refusal signature the D110 gives for a wrong task. Driven as `b1` (PrintStart 7b,
         `PageStart 0x03→0x04`, `SetPageSize` 6b `0x13→0x14`) every command acked, the
         page counter reached 1 at 100 %/100 %, and `PrintEnd 0xf3→0xf4` closed the job.
       - `dpi: 203` is MEASURED against the label, and it CONTRADICTS the spec: the N1 is
         sold as 300 dpi. A row-numbered ruler printed onto a 14 × 50 mm label cut off
         after row 350, and row 350 landed ~45 mm down a 50 mm label → ~7.8 px/mm. At
         300 dpi (11.81 px/mm) row 350 would have been 29.6 mm down, leaving ~20 mm of
         blank label. Record the contradiction explicitly — the next person WILL read the
         spec sheet and doubt this line.
       - `paced: true` is the mode that WORKED, not a proven requirement — the capture ran
         paced because `IS_MAC` forces it, and unpaced was never tried. Same standing and
         same wording as the `2304` (D110) entry.
       - `bundle: false` is the conservative default, never measured.
       - `pagesPerJob` is deliberately ABSENT and that absence is UNTESTED: `copies > 1`
         was never run on this printer. Say so — the D110 is the same task, the same dpi
         and the same small-label family, and it only prints page 1.

  2. `src/niimbot.js`, the `── Printer identification ──` comment block directly above
     `MODEL_IDS` (currently ~line 286): three defects, all pre-existing.
       a. "Validated ids: B1 (4096), B1 Pro (4097); the B1 SE (4098) shares the b1 task.
          Other models exist but are untested" is false — B1 SE (4098) is the only entry
          in the table never seen on hardware. Rewrite so it names the validated ids from
          the table itself and says the B1 SE is the untested one.
       b. The sentence beginning "`paced` = needs the ~10 ms gap between unacked row
          writes" appears TWICE (once ~293-295, once ~300-301). Keep the second, fuller
          one (it also defines `bundle` and `pagesPerJob`) and delete the first.
       c. "(e.g. B1 Pro 50×30 renders at 584 px though its printhead is 567 px)" states as
          fact something `docs/NOTES.md` records as OPEN — 567 is the M2-H's deliberate
          ribbon margin, and whether the B1 Pro's head is 567 or 584 is an unanswered
          question (Vikunja #970). Replace the parenthetical with the M2-H, where the
          numbers are known: its head reports 576 while `T50x30_m2h` renders at 567.
     While there, add one sentence to the protocol-version line: the `0xA5` reply opcode
     is not universal — the D110 answers `0xB5` with too few bytes and the N1 answers
     `0xB4` entirely, so `protocolVersion` is `null` on both and no retry changes that.

  3. `registry.json`, `models`: add `n1` — label "Niimbot N1", id 3586, dpi 203,
     protocol "v4" (that is the FRAMING, which works, exactly as the `d110` entry
     explains), task "b1", density 3, label_type 1, speed 1, name_prefixes ["N1"].
     `_note` records the measured task, the measured 203 dpi, that it contradicts the
     "300 dpi" the printer is sold as, and that `density`/`label_type` are the values the
     printer ACCEPTED (`0x31`, `0x33` acked), not values compared against alternatives.

  4. **Do NOT add a size entry.** The N1's 14 × 50 mm roll needs a `w_px`, and the
     printhead width is not yet measured — the ruler print showed three-digit labels
     truncated to two, which bounds the head to 96 ≤ head < 113 px but does not pin it.
     Guessing 112 (14 mm × 7.992) would silently lose up to 2 mm on the right, which is
     precisely the failure `T15x50`'s `_note` documents on the D110. A follow-up task
     adds the size once the head is measured.

  5. `README.md`: add the N1 row to the supported-printers table (`b1`, 203, 3586,
     ✅ Validated on real hardware), update the "These six" count and any other count your
     change falsifies, and add **N1** to the validated-hardware sentence near the top.
     In the table's Status cell or the paragraph below it, note that the N1 is sold as
     300 dpi and measures 203 — a reader comparing against the spec sheet must not
     conclude the table is wrong. Do NOT add a sizes-table row (see step 4).

  6. `CHANGELOG.md`: one bullet under `## [Unreleased]` → `### Added`, naming T-014, and
     one under `### Fixed` for the comment repairs in step 2. Do NOT bump the version.
Verify:
  - `node --check src/niimbot.js`
  - `node -e "const r=require('./registry.json'); const m=r.models.n1;
     if(!m||m.id!==3586||m.task!=='b1'||m.dpi!==203) throw new Error('n1 model wrong');
     if(Object.values(r.sizes).some(s=>s.w_mm===14)) throw new Error('size added — step 4 says do not');
     console.log('registry ok')"`
  - All six harnesses still pass: `node test/pacing.test.js`, `node test/status.test.js`,
    `node test/unconfirmed.test.js`, `node test/label-memory.test.js`,
    `node test/label-size.test.js`, `node test/one-page-per-job.test.js`
  - Confirm by inspection that `MODEL_IDS[3586]` has no `pagesPerJob` key, and that the
    duplicated `paced` sentence now appears exactly once (`grep -c "needs the ~10 ms gap"
    src/niimbot.js` → 1).
  Data and comments only; no print path changes. The hardware run that justifies this
  already happened — do not claim to have repeated it.

