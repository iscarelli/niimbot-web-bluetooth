# Tasks

Strict execution order — always take the **topmost** open task. Retiring a task
means removing it here **and** logging the change under `## [Unreleased]` in
`CHANGELOG.md` (repo root), plus closing its Vikunja mirror card.

Read `CLAUDE.md` first — especially *The verification that matters is physical*.
No task below may claim a print path works; each is verifiable without a printer,
and hardware confirmation is the maintainer's separate step.

## Active

## [ ] T-042  Run the no-printer harnesses in CI on every push and PR
Why:     the 12 harnesses in `test/` only run when someone remembers to; a CI run makes a regression visible on the commit that caused it.
Vikunja: 2430
Files:   .github/workflows/ci.yml (new), CLAUDE.md, CHANGELOG.md
Do:      1. Create `.github/workflows/ci.yml`, name `CI`, triggered on `push` to `main` and on
            `pull_request` (any branch). One job on `ubuntu-latest`, `permissions: contents: read`,
            steps: `actions/checkout@v7`, `actions/setup-node@v7` with `node-version: 24` (same
            pins as `release.yml`). No `npm install`, no cache, no dependency of any kind.
         2. Step "Syntax": `node --check src/niimbot.js`.
         3. Step "Harnesses": a bash loop over the GLOB `test/*.test.js` — not a hand-written list,
            so a new harness is picked up without editing CI. Run each with `node`, print its
            name, keep going after a failure, and exit non-zero at the end if any failed. It must
            ALSO exit non-zero if the glob matched zero files (a CI that checks nothing and goes
            green is worse than no CI). Do NOT include `test/bringup.mjs` or
            `test/bench-battery.html` — they need hardware/a browser; the `*.test.js` glob already
            excludes them.
         4. Comment block at the top of `ci.yml`, in the style of `release.yml`: what it runs,
            that it needs no printer, and that a green run says NOTHING about printing (link the
            reasoning to CLAUDE.md "The verification that matters is physical").
         5. CLAUDE.md, "Verify commands": add the missing line
            `node test/bluetooth-unsupported.test.js  # connect()'s no-Web-Bluetooth error message (no printer)`
            to the harness list (it exists and passes but was never listed), and one sentence
            after the list saying `.github/workflows/ci.yml` runs every `test/*.test.js` plus the
            syntax check on each push to `main` and each PR. Do not add or change any other rule.
         6. CHANGELOG.md, under `## [Unreleased]`: one entry (internal/CI, not shipped to npm).
         Do NOT touch `release.yml`, `package.json` or `src/`. Do NOT push — commit only, with
         `git commit <paths>` naming exactly the three files plus `docs/TASKS.md`.
Verify:  a) From the repo root, run the exact loop from the "Harnesses" step in bash: exit 0, 12 names printed.
         b) Copy one harness to `test/zz-fail.test.js` containing only `process.exit(1)`, rerun
            the loop: exit non-zero and every other harness still ran. Delete the file.
         c) Run the loop with the glob pointed at an empty temp dir: exit non-zero.
         d) `python -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml'))"` parses
            (if PyYAML is missing, say so — do not report it as passed).
         e) `node --check src/niimbot.js` exits 0.
         The real run on GitHub is the planner's check after push (`gh run list --workflow ci.yml -L 1`).

