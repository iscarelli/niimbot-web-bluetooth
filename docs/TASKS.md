# Tasks

Strict execution order — always take the **topmost** open task. Retiring a task
means removing it here **and** logging the change under `## [Unreleased]` in
`CHANGELOG.md` (repo root), plus closing its Vikunja mirror card.

Read `CLAUDE.md` first — especially *The verification that matters is physical*.
No task below may claim a print path works; each is verifiable without a printer,
and hardware confirmation is the maintainer's separate step.

## Active

## [ ] T-017  Bring-up harness for the browser console (`test/bringup.mjs`)
Why:     bringing up a new model today means pasting a hand-written snippet per round,
         with the reading rule explained in chat and lost afterwards. The B2 Pro and the
         N1 were both brought up that way on 2026-08-14, and three of the N1's labels were
         spent on tests that could not distinguish the hypotheses. The tests that DID work
         are known; this makes them one call each.
Vikunja: 1000
Files:   test/bringup.mjs (new), README.md, CHANGELOG.md
Do:
  Read `docs/NOTES.md` sections *B2 Pro bring-up* and *N1* first — they contain every test
  this harness encodes, including why each reading rule is what it is. Do not invent tests.

  1. New file `test/bringup.mjs` — an ES module, loaded from the demo page's console with

       await import("../test/bringup.mjs")

     (relative on purpose: it resolves the same on `localhost:8080/demo/` and on the Pages
     site). It attaches `window.bringup` and returns nothing. Zero dependencies, no build,
     no framework. It must NOT modify `src/niimbot.js` or the demo. `package.json`'s
     `files` whitelist already keeps `test/` out of npm — do not touch it.

  2. Config, mutable at runtime:

       bringup.config = { name_prefixes: ["N1"], task: "b1", density: 3,
                          label_type: 1, speed: 1, w_px: 200 }

     Every step builds its throwaway `model` from this, exactly as the console snippets
     did — the point is that a model NOT in `registry.json` can be driven, which is what
     makes bring-up possible at all (`assertSelection` is a no-op for an unidentified
     printer; `connect()` falls back to `acceptAllDevices` when `name_prefixes` is empty).

  3. **Every step that prints must call `await Niimbot.disconnect().catch(()=>{})` first.**
     This is not tidiness: `connect()` returns early when a link is already open, and
     `b1Handshake()` only runs inside `connect()` for a `task: "b1"` model — so a step that
     reuses an existing connection silently skips the handshake the D110 needs to print at
     all. Put that reason in a comment; it cost a confusing round on the N1.

  4. Steps. Each one logs, BEFORE printing, a one-line "what to look at", and afterwards
     the reading rule as a small table or bullet list. None of them may conclude anything
     on its own — they print, the human reads the paper.
       - `bringup.info()` — no labels. `probe(0xDC,[0x03])`, then `0x40` sub-codes
         `[0x08,0x0b,0x0d,0x0a,0x07,0x03,0x0c,0x09]`, then `getStatus()`. It must DECODE
         two things rather than dumping hex: the printhead width from the `0xDE` reply
         (bytes 4-5, big-endian) and the ASCII of `0x40[0b]` (serial). If `0xDC[03]`
         answers with cmd `0x00` (the N1 refuses it), say plainly that this model does not
         report its head and that `bringup.head()` is the only way to get it.
       - `bringup.dpi({ h_mm })` — the numbered ruler that actually settled the N1: a page
         `Math.round(h_mm * 11.811)` rows tall (the 300 dpi hypothesis), a tick every 50
         rows labelled with its row number, text at x=2 so the head cannot clip the digits
         (on the N1 it clipped them at x=62 and that accident is what bounded the head —
         keep the accident possible by ALSO drawing a 55 px tick, but never let it eat the
         number). Afterwards log: "the last number printed, divided by `h_mm`, is px/mm —
         7.99 = 203 dpi, 11.81 = 300 dpi".
       - `bringup.head({ widths })` — stacked bands, default `[80, 96, 104, 112, 120]`,
         each labelled with its own width. Reading rule: bands that end at the same place
         are both clipped, so the head is ≤ the smallest of those; the largest band that is
         visibly narrower is < the head.
       - `bringup.copies({ n = 3 })` — `n` copies of a page carrying a big "X", at the
         configured geometry. Reading rule: `n` labels means no `pagesPerJob` cap and that
         absence is now measured; 1 label means `pagesPerJob: 1`, like the D110.
       - `bringup.task()` — prints the same small block once, and afterwards states the
         discriminator in words: if the 13-byte `SetPageSize` and `PageEnd` drew `0xdb 06`
         and no `0x14`/`0xe4`, the framing is right and the task is wrong — set
         `bringup.config.task = "b1"` and run again. It must NOT auto-retry: a second job
         fired at a printer that just refused one is how state gets confused.

  5. `bringup.help()` — logs the available steps, the current config, and the one-line
     loader. A harness nobody can remember the entry points of gets re-pasted from chat,
     which is the problem this task exists to end.

  6. `README.md`: a short subsection under the existing bring-up/discovery material (the
     D11_H "worked example" paragraph is the right neighbour) pointing at the harness and
     showing the one-line loader. Keep it to a pointer — the reading rules live in the
     code and in `docs/NOTES.md`, and duplicating them here would create a second copy to
     rot.

  7. `CHANGELOG.md`: one bullet under `## [Unreleased]` → `### Added`, naming T-017.
Verify:
  - `node --check test/bringup.mjs` (Node parses `.mjs` as a module, so `import`/top-level
    `await` are accepted; a `.js` extension would fail this gate — that is why the file is
    `.mjs`)
  - `node --check src/niimbot.js` — must be untouched; `git diff --stat src/niimbot.js`
    reports no change
  - `node -e "const fs=require('fs'), s=fs.readFileSync('test/bringup.mjs','utf8');
     for(const k of ['info','dpi','head','copies','task','help']) if(!new RegExp('\\\\b'+k+'\\\\s*[:(]').test(s)) throw new Error('missing step '+k);
     if(!/disconnect/.test(s)) throw new Error('no disconnect — see step 3');
     console.log('harness ok')"`
  - Confirm by inspection that no step returns or logs a verdict about whether a print
    SUCCEEDED. The harness reports what was sent and what to look for; the paper decides.
  This is a testing instrument, not a print path. It cannot be exercised without a printer,
  and you must not claim it works end to end — say plainly in your report that a real
  bring-up run against hardware is outstanding and is the maintainer's step.

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

