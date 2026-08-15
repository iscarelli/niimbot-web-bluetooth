# Tasks

Strict execution order — always take the **topmost** open task. Retiring a task
means removing it here **and** logging the change under `## [Unreleased]` in
`CHANGELOG.md` (repo root), plus closing its Vikunja mirror card.

Read `CLAUDE.md` first — especially *The verification that matters is physical*.
No task below may claim a print path works; each is verifiable without a printer,
and hardware confirmation is the maintainer's separate step.

## Active

## [ ] T-022  `T14x50` offset goes from −2 to −3
Why:     the coarse sweep only tried EVEN candidates (`0, -2, -4, -8, -10`), so −3 was
         never on the paper. At −2 the label's bottom line still only partly caught,
         which is the signature of the true value sitting between −2 and −4. The
         maintainer asked for −3 on hardware, 2026-08-15.
Vikunja: 997
Files:   registry.json, CHANGELOG.md
Do:
  1. `registry.json`, `sizes.T14x50`: change `offset_y_px` from `-2` to `-3`.
     Change nothing else — `w_px` 96 and `h_px` 400 stay.

  2. Its `_note` currently says −2 was measured by a six-candidate sweep. That is still
     true about the sweep, but the value shipped is now −3, so the note must say what
     actually happened rather than being edited to pretend the sweep found −3:
       - the six-candidate sweep (`0, -2, -4, -6, -8, -10`) picked −2 as the best of
         those, and −2 shipped;
       - printing at −2 through the demo then showed the bottom line still only partly
         landing, and the sweep's grid had no odd values, so its answer was the best
         available candidate rather than the best value;
       - −3 is the maintainer's call from that print, 2026-08-15.
     Keep the existing warning that `T15x50`'s offset must not be copied — that
     prohibition is why this entry was measured independently in the first place, and
     the two values now differ, which makes it more relevant, not less.
     Keep the recorded cost, updated: a negative offset crops the TOP rows of the source,
     so −3 loses ~0.37 mm (was ~0.25 mm at −2). Content flush to the top edge is clipped.

  3. `CHANGELOG.md`: `## [Unreleased]` already carries the T-019 bullet that introduced
     `offset_y_px: -2` and it has NOT been released. Do not add a second bullet that
     contradicts the first — amend the T-019 bullet to state the shipped value as −3 and
     name T-022 alongside it. A release note describing a value the release does not
     contain is worse than a terse one.
Verify:
  - `node -e "const s=require('./registry.json').sizes.T14x50;
     if(s.offset_y_px!==-3) throw new Error('offset_y_px must be -3, got '+s.offset_y_px);
     if(s.w_px!==96||s.h_px!==400) throw new Error('geometry must not change');
     console.log('registry ok')"`
  - `node test/label-size.test.js` and `node test/label-memory.test.js` pass
  - `node --check src/niimbot.js`
  - `node -e "const fs=require('fs'); const c=fs.readFileSync('CHANGELOG.md','utf8');
     const u=c.slice(c.indexOf('## [Unreleased]'), c.indexOf('## [2.'));
     if(/offset_y_px&#96;?: -2|offset of -2|\`-2\`/.test(u)) throw new Error('Unreleased still advertises -2');
     console.log('changelog ok')"`
  Data only. A confirming print at −3 through the demo is the maintainer's step; the value
  itself came from their reading of the paper, so do not re-derive it.
