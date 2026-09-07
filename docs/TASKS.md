# Tasks

Strict execution order — always take the **topmost** open task. Retiring a task
means removing it here **and** logging the change under `## [Unreleased]` in
`CHANGELOG.md` (repo root), plus closing its Vikunja mirror card.

Read `CLAUDE.md` first — especially *The verification that matters is physical*.
No task below may claim a print path works; each is verifiable without a printer,
and hardware confirmation is the maintainer's separate step.

## Active

## [ ] T-023  Narrow T50x30 to the printhead width the B1 Pro reports
Why:     `T50x30` sends `w_px` 584 to a printer that reports a 576 px head, so the
         rightmost 8 px (0.68 mm) is dropped with no error — the same defect T-020
         retracted for the M2-H, now measured on the B1 Pro itself (docs/NOTES.md,
         § "The B1 Pro reports a 576 px head").
Files:   registry.json, README.md, CHANGELOG.md
Do:      In `registry.json`, set `sizes.T50x30.w_px` to 576 (leave `h_px` 354 and
         `offset_y_px` untouched). Add a `_note` to that entry saying: the value is the
         printhead width the printer reports via `probe(0xdc,[0x03])` on a B1 Pro
         (model id 4097, read 2026-09-07) AND confirmed on paper the same day: printing
         four 4 px steps at columns 568, 572, 576 and 580 with `w_px` 584, the steps at 568
         and 572 came out and those at 576 and 580 did not, so columns 0-575 print and 576
         does not. The previous 584 exceeded the head by 8 px = 0.68 mm, which prints
         nothing and raises no error. See docs/NOTES.md, the two sections dated 2026-09-07.
         Do not touch `T50x30_m2h` (567, a deliberate ribbon-drift margin) or
         `T50x30_b2pro` (576).
         In `README.md`, update the two places that state 584 for the B1 Pro: the
         `w_px` table row (`| T50x30 | B1 Pro | 584 | ... |`, whose reason column must
         change from "the printable width used on that printer" to the reported head
         width) and the shipped-sizes table row (`584 × 354` becomes `576 × 354`). The
         inline `<script>` example comment that says `size 584×354` changes too. Leave the
         withdrawn-claim paragraph about the M2-H as it stands; it is still correct.
         Add a `## [Unreleased]` entry to `CHANGELOG.md` under `### Fixed`, naming the task
         and stating plainly that the paper comparison is outstanding.
Verify:  `node --check src/niimbot.js` (no source change is expected, so this only proves
         nothing was broken), and
         `python -c "import json;d=json.load(open('registry.json',encoding='utf-8'));s=d['sizes'];assert s['T50x30']['w_px']==576;assert s['T50x30_m2h']['w_px']==567;assert s['T50x30_b2pro']['w_px']==576;print('ok')"`
         Then `grep -n 584 README.md registry.json` must return nothing.
         Hardware confirmation for this one is already DONE (docs/NOTES.md, 2026-09-07),
         so the changelog entry may state that the 576 is confirmed on paper. It must still
         not claim that any print path was exercised by this task: nothing here prints.
