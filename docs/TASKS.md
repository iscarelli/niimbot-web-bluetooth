# Tasks

Strict execution order — always take the **topmost** open task. Retiring a task
means removing it here **and** logging the change under `## [Unreleased]` in
`CHANGELOG.md` (repo root), plus closing its Vikunja mirror card.

Read `CLAUDE.md` first — especially *The verification that matters is physical*.
No task below may claim a print path works; each is verifiable without a printer,
and hardware confirmation is the maintainer's separate step.

## Active

## [ ] T-005  A job that cannot be confirmed must not resolve as success
Why:     measured on 2026-08-13: a batch printed 4 of 5 labels and the driver logged
         `all 5 pages printed` and resolved "ok". Two independent silent failures let
         it: the page-counter wait gives up without a signal, and the PageEnd ack is
         discarded. This is the exact "100% green, blank paper" mode the project has
         shipped twice (v1.3.3, v1.3.4).
Vikunja: 966
Files:   src/niimbot.js, test/unconfirmed.test.js (new), CHANGELOG.md, README.md, CLAUDE.md

Do:
  1. `waitPage` (`src/niimbot.js:718-730`) currently falls out of its 25 s `while` and
     `return`s indistinguishably from success. Make it **return `true`** when
     `st.page >= target` and **`false`** when the deadline passes, and have it remember
     the last counter value it saw so the caller can report it.
  2. Replace the hard-coded `25000` with a module constant exported on the namespace as
     `Niimbot.PAGE_WAIT_MS` (default `25000`), read per call. The test needs to shrink
     it; a 25 s test is a test nobody runs.
  3. `sendPagePacked` (`src/niimbot.js:712`) throws away the result of
     `sendWait(0xe3, [0x01], 0xe4, 3000)`. Capture it and **return whether PageEnd was
     acked**. `sendWait` already returns `null` on timeout and logs the `⚠` line
     (`src/niimbot.js:217-224`) — no change needed there.
  4. In `printBatch` (`src/niimbot.js:773-807`) and `printImage`/`finishJob`
     (`src/niimbot.js:739-764`), treat an unacked PageEnd or a `false` from `waitPage`
     as **unconfirmed**: stop sending further pages, and record what failed.
  5. **Send `endJob()` (PrintEnd, 0xF3) anyway, then throw.** Order matters and is not
     optional: PrintEnd is what feeds out and retracts the paper
     (`src/niimbot.js:662-665`), so skipping it on the error path leaves the label
     parked under the printhead. Throw only after it is sent.
  6. The `Error` message must name what was not confirmed and the numbers behind it —
     e.g. `print not confirmed: printer counter stopped at page 4 of 5 after 25000ms
     (PrintEnd sent, paper fed out)`, or for the ack case, which page's PageEnd went
     unacked. A bare "print failed" would repeat the mistake this task exists to fix.
  7. **Fix the log lines that state the false claim**: `page ${i}: buffered (PageEnd
     acked)` (`src/niimbot.js:795`), the same line in `printImage`
     (`src/niimbot.js:760`), and `all ${N} pages printed` (`src/niimbot.js:803`) must
     not be printed when the thing they assert did not happen. In the captured log they
     appeared *directly under* the `⚠ no response to e3` warning.
  8. Update the header comment block (`src/niimbot.js:1-21`) and README wherever they
     describe `printBatch`/`printImage` as resolving on completion — the contract now
     includes a rejection. Add the `## [Unreleased]` CHANGELOG entry (Fixed) in the same
     commit, and the new harness to the Verify list in `CLAUDE.md`.

Verify:
  `node --check src/niimbot.js` and a new `node test/unconfirmed.test.js`, built like
  the existing harnesses (stub `navigator` via `Object.defineProperty` BEFORE loading
  the file — see `CLAUDE.md`), with `Niimbot.PAGE_WAIT_MS` set to ~300 ms. Four cases,
  all against a fake characteristic, no printer:
    a. counter never reaches target → `printBatch` **rejects**, the message contains the
       last page seen and the target, and `0xf3` **was written before** the rejection;
    b. PageEnd (`0xe3`) never answered with `0xe4` → rejects, message names the page,
       `0xf3` still written first;
    c. happy path (counter advances, every `0xe3` answered) → resolves, and none of the
       three log lines from step 7 are suppressed;
    d. `waitPage` returning `false` for the look-ahead call does not leave the loop
       sending the remaining pages.
  Assert on the ORDER of writes in (a) and (b), not just their presence — "PrintEnd was
  sent" and "PrintEnd was sent first" are different claims, and only the second protects
  the paper.

  This is a mechanical verification only. It proves the driver stops lying about an
  unconfirmed job; it does NOT prove any print path works. Say so in the report —
  hardware confirmation is the maintainer's step (Vikunja 967).
