# Tasks

Strict execution order — always take the **topmost** open task. Retiring a task
means removing it here **and** logging the change under `## [Unreleased]` in
`CHANGELOG.md` (repo root), plus closing its Vikunja mirror card.

Read `CLAUDE.md` first — especially *The verification that matters is physical*.
No task below may claim a print path works; each is verifiable without a printer,
and hardware confirmation is the maintainer's separate step.

## Active

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

