# Tasks

Strict execution order — always take the **topmost** open task. Retiring a task
means removing it here **and** logging the change under `## [Unreleased]` in
`CHANGELOG.md` (repo root), plus closing its Vikunja mirror card.

Read `CLAUDE.md` first — especially *The verification that matters is physical*.
No task below may claim a print path works; each is verifiable without a printer,
and hardware confirmation is the maintainer's separate step.

## Active

## [ ] T-018  N1 `pagesPerJob: 1` (measured) + cover it in the harness
Why:     the N1 acks a 3-copy job, receives every row, and prints ONE label — the D110's
         defect on a second model. Without the field the driver hands the caller one label
         and a 25 s timeout instead of three labels.
Vikunja: 997
Files:   src/niimbot.js, registry.json, test/one-page-per-job.test.js, README.md,
         CHANGELOG.md
Do:
  Measured on hardware 2026-08-14; the capture is in `docs/NOTES.md` → *N1* →
  *`pagesPerJob: 1` — measured, and it stops being a D110 anecdote*. Read it first.

  1. `src/niimbot.js`, `MODEL_IDS[3586]`: add `pagesPerJob: 1` to the existing entry.
     The entry's comment currently says the absence of the field is UNTESTED — that
     sentence is now false and must be replaced with what was measured:
       - `SetPageSize` went out as `13 (6b) 01 90 00 60 00 03` (400 rows, 96 px, 3 copies)
         and was **acked** with `14`;
       - `d3: 01 8f 01` = 399, so all 400 rows arrived — nothing was lost on the radio;
       - one label printed, the counter parked at `page 1 / 100 % / 100 %` until
         `PAGE_WAIT_MS` expired and the driver threw.
     Keep it factual and do not generalise to other models.

  2. `test/one-page-per-job.test.js`: add an N1 case mirroring the existing D110 case (a).
     You will need `N1_ID = [0x0e, 0x02]` (3586) and an `N1_MODEL` with
     `name_prefixes: ["N1"], task: "b1", density: 3, label_type: 1, speed: 1`. Assert the
     same property (a) asserts: `printImage({copies: 3})` emits **three** separate
     `PrintStart(pages=1)`/`PrintEnd` pairs and never a `SetPageSize` with copies > 1.
     Also extend the existing identification check (0) with an N1 equivalent, so a wrong
     `N1_ID` fails as "the harness does not identify the N1" rather than as a mysterious
     job-count mismatch — that is why (0) exists.
     Do NOT make the fake printer answer `0xB4` to `0xA5`: this harness measures job
     splitting, and modelling the N1's protocol quirks here would couple it to something
     it does not test. Say so in a comment so nobody "fixes" it later.

  3. `registry.json`, `models.n1._note`: it describes the model as measured; add the
     `pagesPerJob` finding in one sentence, with the same standing (measured, per-model).

  4. `README.md`: if any sentence about the N1 or about `pagesPerJob` becomes false, fix
     it. If the D110 is described as the only model with the cap, that is now wrong.

  5. `CHANGELOG.md`: one bullet under `## [Unreleased]` → `### Fixed`, naming T-018. This
     is user-visible: without it a 3-copy job on an N1 yields one label and an error.
Verify:
  - `node --check src/niimbot.js`
  - `node test/one-page-per-job.test.js` — must PASS with the new N1 cases AND the
    existing (c) B1 Pro regression still emitting ONE job. If (c) breaks, stop: it means
    the cap leaked into a model that does not have it, which is the exact bug the file
    exists to prevent.
  - The other five harnesses still pass: `pacing`, `status`, `unconfirmed`,
    `label-memory`, `label-size`
  - `node -e "const r=require('./registry.json'); if(!/pagesPerJob/.test(r.models.n1._note||'')) throw new Error('registry note not updated'); console.log('registry ok')"`
  The new test case is real verification of the SPLITTING logic (it runs against the fake
  GATT). It is not verification that the N1 prints three labels — that is hardware, it is
  outstanding, and it is the maintainer's step.

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

