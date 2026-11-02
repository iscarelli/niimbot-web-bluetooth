# Tasks

Strict execution order — always take the **topmost** open task. Retiring a task
means removing it here **and** logging the change under `## [Unreleased]` in
`CHANGELOG.md` (repo root), plus closing its Vikunja mirror card.

Read `CLAUDE.md` first — especially *The verification that matters is physical*.
No task below may claim a print path works; each is verifiable without a printer,
and hardware confirmation is the maintainer's separate step.

## Active

## [ ] T-043  Several printers per page: one driver instance per printer
Why:     mellcaetano's catalog runs a B1 and a D11 from one bridge page at the same time; today the module keeps ONE connection (`let device` at src/niimbot.js:91).
Files:   src/niimbot.js, test/instances.test.js (new), README.md, CHANGELOG.md
Do:      Move all per-connection state (device, characteristic, waiters, connected model/meta, pacing, any other mutable module-level state tied to a connection) into a factory `Niimbot.create()` that returns an object with the SAME public API as `Niimbot` today (connect, disconnect, printImage, printBatch, readiness, battery, getStatus, connectedMeta and every other exported member). The global `Niimbot` stays and becomes `Niimbot.create()`'s default instance plus `create` itself, so every existing caller works unchanged. Pure helpers with no connection state may stay shared. No behaviour change for a single printer. README: a short "Two printers on one page" section with a code sample (`const b1 = Niimbot.create(); const d11 = Niimbot.create();`). CHANGELOG under [Unreleased]: Added.
Verify:  node --check src/niimbot.js; every existing `node test/*.test.js` passes unchanged; new test/instances.test.js (browser globals stubbed as the other harnesses do) proves: two instances connect to two fake devices and a notification on device A resolves only A's waiter; disconnect of A leaves B connected; `Niimbot.printImage === Niimbot.printImage` of the default instance still exists. Hardware (maintainer, separate Vikunja step): B1 + D11 connected and printing at the same time in Chrome on Windows.

