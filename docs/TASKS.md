# Tasks

Strict execution order — always take the **topmost** open task. Retiring a task
means removing it here **and** logging the change under `## [Unreleased]` in
`CHANGELOG.md` (repo root), plus closing its Vikunja mirror card.

Read `CLAUDE.md` first — especially *The verification that matters is physical*.
No task below may claim a print path works; each is verifiable without a printer,
and hardware confirmation is the maintainer's separate step.

## Active

## [ ] T-019  `T14x50` gets `offset_y_px: -2` (measured on an N1, not copied)
Why:     the first print at the shipped 96 × 400 geometry came out clipped at the bottom.
         A six-candidate offset sweep on real hardware picked −2. Without it every N1 print
         loses content at the end of the label.
Vikunja: 997
Files:   registry.json, CHANGELOG.md
Do:
  Measured 2026-08-15; the capture is `docs/NOTES.md` → *N1* → *`offset_y_px: -2` — and the
  sweep answered a second question nobody asked it*. Read it first.

  1. `registry.json`, `sizes.T14x50`: add `offset_y_px: -2`.

  2. Its `_note` currently explains at length why `T15x50`'s `-2` must NOT be copied. That
     warning stays — but it now reads as if this entry has no offset, which is false.
     Rewrite that part so it says, in this order:
       - `T14x50` has its own `offset_y_px: -2`, **measured on an N1** by the six-candidate
         sweep (`0, -2, -4, -6, -8, -10`), each candidate printed with its own value drawn
         on the label and compared against the physical edge;
       - it happens to equal the D110's, and that is a coincidence of two measurements, not
         a shared source. Copying `T15x50`'s value would have produced the same number by
         luck and taught the next person that copying is fine, which is why the earlier
         prohibition existed and why it must stay in the note;
       - what the sweep also established: a 400-row page fitting a 50 mm label with 2 rows
         of correction means the printable area IS 400 rows over 50 mm — 8.0 px/mm, exactly
         203 dpi. So `h_px: 400` is confirmed by a second, independent route, and the
         clipping was registration, not an over-long page.
     Also record the known cost, as `T15x50`'s note does for its own −2: a negative offset
     crops the TOP rows of the source (here 2 rows ≈ 0.25 mm), so content drawn flush
     against the top edge will still be clipped.

  3. `CHANGELOG.md`: one bullet under `## [Unreleased]` → `### Fixed`, naming T-019. This
     is user-visible — without it, N1 prints lose the bottom of the label.
Verify:
  - `node -e "const s=require('./registry.json').sizes.T14x50;
     if(s.offset_y_px!==-2) throw new Error('offset_y_px must be -2, got '+s.offset_y_px);
     if(s.h_px!==400||s.w_px!==96) throw new Error('geometry must not change');
     console.log('registry ok')"`
  - `node test/label-size.test.js` and `node test/label-memory.test.js` pass
  - `node --check src/niimbot.js`
  Data only. The sweep that justifies this already ran on hardware — do not claim to have
  repeated it, and note in your report that a confirming print at `-2` through the demo's
  normal path is outstanding and is the maintainer's step.

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

