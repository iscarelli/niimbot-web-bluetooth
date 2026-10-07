# Tasks

Strict execution order — always take the **topmost** open task. Retiring a task
means removing it here **and** logging the change under `## [Unreleased]` in
`CHANGELOG.md` (repo root), plus closing its Vikunja mirror card.

Read `CLAUDE.md` first — especially *The verification that matters is physical*.
No task below may claim a print path works; each is verifiable without a printer,
and hardware confirmation is the maintainer's separate step.

## Active

## [ ] T-041  A roll remembers its millimetres; the pixels come from the connected printer
Why:     A roll is physical and fits any dpi, but the demo stores it as a pixel size of ONE model (e.g. "C50x15_300", computed for whatever the Model selector showed) and shows that dpi in the Rolls panel. A roll registered with the selector on the B1 Pro carried 300 dpi / 584 px onto a D110_M.
Vikunja: 1928
Files:   src/label-memory.js, test/label-memory.test.js, demo/index.html, README.md, CHANGELOG.md
Do:
  Model: a roll record is { w_mm, h_mm, name?, color? } — the label's physical size,
  w_mm ACROSS the printhead, h_mm ALONG the feed. No dpi, no px. A legacy record
  { size: "<id>", ... } stays valid and is read through that size's w_mm/h_mm.
  1. src/label-memory.js: normalize()/toRecord() also accept a record with no `size`
     when w_mm and h_mm are both finite numbers > 0 (a record with `size` keeps working
     unchanged; a bare string is still shorthand for { size }). Update the comments
     that say callers must read `.size` (e.g. above recall). Bump the module's own
     VERSION "1.0.0" → "1.1.0" (additive). Do not touch src/niimbot.js.
  2. test/label-memory.test.js: add cases — mm-only record round-trips via
     remember/recall/seed; record with w_mm 0 / missing h_mm / NaN is rejected; legacy
     string and { size } still work.
  3. demo/index.html — one resolver, used by every path below:
     `sizeForRoll(rec)` → size id for the CURRENTLY SELECTED model, or null.
     a. mm = rec.w_mm/h_mm, else allSizes()[rec.size].w_mm/h_mm (legacy). If neither
        is available, return rec.size only if it is offered in the size dropdown.
     b. Prefer a SHIPPED registry size with exactly these mm whose key ends in
        "_" + modelKey (e.g. T15x50_d110m for d110m) — those carry per-model offsets.
     c. Else a shipped size with these mm and this dpi that is offered in the dropdown
        AND is not suffixed for a different model key (T15x50 has no suffix but is the
        D110's; acceptable fallback, but log which entry was chosen).
     d. Else a custom size keyed `C{w}x{h}_{modelKey}` (dots → "_"); create it from
        NiimbotLabelSize.sizeFromMm with this model's dpi and PRINTHEAD_PX if missing,
        exactly as Save roll does today (same clamp warning to the log).
        Key by MODEL, not dpi: the B1 Pro and the B2 Pro are both 300 dpi with
        different heads, so `_300` was never a correct identity. Existing `C…_300`
        custom sizes stay where they are, untouched.
     Then:
     - reviewTag(): use sizeForRoll(rec) instead of rec.size. Log the mm and the
       resolved id; no dpi in the message.
     - Model change (the `change` listener on #model and the auto-select after
       Connect & identify): if a tag has been read this session, re-resolve so the
       same roll gets the new printer's pixels.
     - Save roll: store { w_mm, h_mm, name?, color? } (delete any old `size` on that
       record), then select sizeForRoll(rec). Save without a tag read: keep today's
       behaviour (create/select the size), message unchanged in spirit.
     - rememberAfterPrint(sizeId): learn the PRINTED size's w_mm/h_mm into the record
       (merge, keep name/color, drop `size`); if that size has no mm, fall back to
       today's { size } behaviour.
     - Read tag pre-fill: take mm from the record (or legacy size).
     - Rolls list: show "name · W × L mm · color" from the record's mm — never a dpi
       or px. Keep the "(size not defined here)" warning only for a legacy record whose
       size id is unknown.
     - Form labels: "Width mm (across the head)" and "Length mm (along the feed)";
       one muted line under the form: narrow labels feed standing — a 15 × 50 roll is
       width 15, length 50. #rollcalc keeps showing px/clamp for the SELECTED printer,
       prefixed "On <model label>:" so it reads as the printer's, not the roll's.
     - Copy JSON: unchanged shape { sizes, rolls }; rolls now carry mm.
     - Import JSON: accept a roll with numeric w_mm/h_mm (validated with the same
       num() bounds) OR a legacy `size`; reject neither-nor (count as skipped).
  4. README.md: the Rolls-panel paragraph and the label-memory API section — record
     is { w_mm, h_mm, name?, color? } (legacy { size } still read). Keep it short.
  5. CHANGELOG.md `## [Unreleased]`: Changed entry (demo + label-memory 1.1.0).
     Do not bump the package version.
  Note for the report: rolls already saved lying down (e.g. a 15 mm-wide roll saved as
  50 × 15) resolve to the wrong orientation; they must be forgotten and re-saved. Do
  not try to auto-detect orientation.
Verify:
  - node --check src/label-memory.js && node test/label-memory.test.js (new cases pass)
  - The demo inline-script syntax check from CLAUDE.md (every block returns 0).
  - Every harness in CLAUDE.md's Verify list still passes.
  - Browser check with no printer: `node demo/serve.mjs`, open the demo in Chrome
    (Playwright is fine), and in the console:
      labelMemory.remember("T1", { w_mm: 15, h_mm: 50 });
      set #model to "d110m", dispatch change;
      reviewTag({ decoded: { rfid: { tagPresent: true, barCode: "T1", consumablesType: 1 } } }, true)
      → #size is "T15x50_d110m". Switch #model to "n1" → rule c picks "T15x50"
      (unsuffixed, 203 dpi, same mm) and the log names it. Switch to "b1pro"
      → "C15x50_b1pro". Rolls list text contains "15 × 50 mm" and no "dpi".
    Also: a legacy record { size: "T50x30" } on b1pro still selects T50x30.
    Report each observed value; no screenshots needed.
  - Hardware: none required (no print path changes) — say so.
