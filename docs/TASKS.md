# Tasks

Strict execution order — always take the **topmost** open task. Retiring a task
means removing it here **and** logging the change under `## [Unreleased]` in
`CHANGELOG.md` (repo root), plus closing its Vikunja mirror card.

Read `CLAUDE.md` first — especially *The verification that matters is physical*.
No task below may claim a print path works; each is verifiable without a printer,
and hardware confirmation is the maintainer's separate step.

## Active

## [ ] T-015  N1 label size `T14x50` (printhead measured at 96 px)
Why:     T-014 shipped the N1 with no size on purpose, because its printhead was only
         bounded. It has since been pinned at 96 px on hardware, so the size can be
         written. Without it the demo offers the N1 only sizes belonging to other printers.
Vikunja: 998
Files:   registry.json, README.md, CHANGELOG.md
Do:
  1. `registry.json`, `sizes`: add `T14x50` — label "14 × 50 mm (N1)", code "T14*50",
     w_mm 14, h_mm 50, **w_px 96**, **h_px 400**, margin 6, dpi 203.
     **Do NOT add `offset_y_px`.** See point 3.
     `_note` must record:
       - `w_px` 96 is the **PRINTHEAD, not the label**: 14 mm at 203 dpi is 112 px, so
         ~1 mm on each side stays unprinted, and that is the printer, not a choice.
       - How 96 was pinned, because it is two bounds rather than one reading: a ruler
         print whose two-digit label `50` survived while three-digit `100` was cut puts
         the head at ≥ ~96; five stacked bands (80/96/104/112/120 px) came out identical
         from 96 up and narrower at 80, putting it at ≤ 96 and > 80. The intervals meet at
         96, which is also the stride-aligned multiple of 8 — the same reasoning that
         fixed the D110's head. Both on hardware, 2026-08-14.
       - `h_px` 400 is arithmetic from the MEASURED 203 dpi (50 mm × 7.992), the same
         standing as `T15x50`'s geometry.
  2. `README.md`: add the `T14x50` row to the sizes table (N1, 14 × 50, 203 dpi, 96 × 400).
     **The blockquote T-014 added under the supported-printers table says no size ships for
     the N1 and why — that sentence is now false.** Rewrite it to say the size ships and
     that its `w_px` is the printhead; keep the 203-vs-300-dpi caveat, which is still true.
     Fix any count your change falsifies.
  3. `T14x50` comes out geometrically identical to the D110's `T15x50` (96 × 400). They
     stay separate entries and you must NOT copy `T15x50`'s `offset_y_px: -2`: that value
     was measured on a D110 by a six-label sweep, and paper registration has never been
     measured on an N1. Say this in the `_note` so the next reader does not "unify" them.
  4. `CHANGELOG.md`: one bullet under `## [Unreleased]` → `### Added`, naming T-015. Do
     NOT bump the version.
Verify:
  - `node -e "const r=require('./registry.json'), s=r.sizes.T14x50;
     if(!s||s.w_px!==96||s.h_px!==400||s.dpi!==203||s.w_mm!==14) throw new Error('T14x50 wrong');
     if('offset_y_px' in s) throw new Error('offset_y_px must not be set — never measured on N1');
     console.log('registry ok')"`
  - `node test/label-size.test.js` and `node test/label-memory.test.js` pass
  - `node --check src/niimbot.js` (unchanged, but the cheapest gate — always run it)
  Data only; no code path changes. Hardware confirmation of a print at this geometry is
  the maintainer's step and is NOT part of this task.

## [ ] T-016  Stop the printhead clamp from failing silently, and unstale `package.json`
Why:     two defects the T-013/T-014 implementers flagged. The clamp one is the worse
         kind: the demo's roll calculator passes `printhead_px: undefined` for any model
         missing from a hand-written map, so it never reports a clamp — a check that
         answers "fine" because it could not check is worse than no check.
Vikunja: 999
Files:   demo/index.html, package.json, CHANGELOG.md
Do:
  1. `demo/index.html`, the hardcoded `PRINTHEAD_PX` map (grep the name; currently ~595)
     reads `{ b1pro: 584, b1: 384, m2h: 567, d110: 96 }`. Add the three registry models
     missing from it: **`b2pro: 576`**, **`d11h: 144`**, **`n1: 96`**.
     Then add a comment above the map stating, accurately, where each number comes from —
     and this is the point of the task, so do not soften it:
       - `b2pro` 576 and `d11h` 144 are printhead widths the PRINTER REPORTS ITSELF via
         `probe(0xDC, [0x03])`, both corroborated on paper. `n1` 96 and `d110` 96 are
         measured by print comparison. These four are real head widths.
       - `b1pro` 584, `b1` 384 and `m2h` 567 are **NOT verified head widths** and predate
         this map having a stated meaning. `m2h` 567 is demonstrably not the head — that
         printer reports 576 and 567 is a deliberate ribbon margin (see `registry.json`'s
         `T50x30_m2h` note). Whether the B1 Pro's head is 567 or 584 is an open question
         (Vikunja #970), answerable with no labels by running `probe(0xDC, [0x03])` on one.
       - Leave those three values ALONE. Correcting them is a separate, hardware-backed
         decision, not a drive-by edit. The comment exists so the next reader knows which
         rows to trust.
     Do not restructure the map or move it into `registry.json` — the registry has no
     printhead field today, and adding one means deciding what the untrusted three should
     say, which is exactly what this task defers.
  2. `package.json`, `description`: it reads "Validated on B1, B1 Pro, M2-H, D11_H and
     D110" and now misses **B2 Pro** and **N1**. Add both. Change ONLY the `description`
     string — do not touch `version` (releasing is the maintainer's step).
  3. `CHANGELOG.md`: one bullet under `## [Unreleased]` → `### Fixed`, naming T-016.
Verify:
  - Extract and syntax-check the demo's inline scripts with the python snippet in
    `CLAUDE.md` (§ Verify commands) — every block must return 0.
  - `node -e "const p=require('./package.json'), r=require('./registry.json');
     for(const k of ['B2 Pro','N1']) if(!p.description.includes(k)) throw new Error('description missing '+k);
     if(p.version!==require('./package.json').version) throw new Error('unreachable');
     console.log('package ok')"`
  - `node -e "const fs=require('fs'); const s=fs.readFileSync('demo/index.html','utf8');
     const m=s.match(/PRINTHEAD_PX\s*=\s*\{[^}]*\}/)[0];
     for(const k of ['b2pro','d11h','n1','b1pro','b1','m2h','d110']) if(!new RegExp('\\\\b'+k+'\\\\s*:').test(m)) throw new Error('PRINTHEAD_PX missing '+k);
     console.log('map ok')"`
  - Then confirm by inspection that every model key in `registry.json` has an entry in the
    map. That is the property that actually matters; the regex above only checks the seven
    known today.

