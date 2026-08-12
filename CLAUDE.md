# niimbot-web-bluetooth — project rules

Zero-dependency Web Bluetooth driver for Niimbot label printers, published to npm
and served as a live demo from GitHub Pages. One source file: `src/niimbot.js`.

## Verify commands

There is **no build, no bundler, no test suite and no linter** — do not invent one.
Verification is:

```bash
node --check src/niimbot.js     # syntax only; the cheapest gate, always run it
node demo/serve.mjs             # then open http://localhost:8080/demo/ in Chrome
```

For logic that can be exercised without a printer, write a throwaway Node harness
that stubs the browser globals (`globalThis.navigator` must exist **before** the
file loads — `IS_MAC` at `src/niimbot.js:104` reads `navigator.platform` at load
time and throws in bare Node). Keep such harnesses under `test/`; `package.json`
`files` whitelists what ships, so `test/` never reaches npm.

## The verification that matters is physical

**A print that reports success is not a print.** This driver's characteristic
failure mode — hit twice, v1.3.3 and v1.3.4 — is a label that comes out **blank or
short while progress reports 100%**, because unacked BLE writes are dropped
silently. No amount of green console output detects it.

So: an implementer verifies **mechanically** (syntax, harness, code inspection) and
says plainly in its report that hardware confirmation is outstanding. It must never
claim a print path works. Hardware confirmation is the maintainer's step — it needs
a real printer and a human looking at the paper — and belongs on a Vikunja card, not
in `docs/TASKS.md`.

## Project constraints

- **Zero dependencies, forever.** It is in the package description, a README badge,
  and the reason people pick this over alternatives. Never add one, not even a dev
  dependency.
- **No build step.** `src/niimbot.js` ships verbatim and loads via `<script>`,
  attaching `window.Niimbot`. Keep it one browser-global IIFE.
- **Per-model, not per-task.** Flow-control and bundling behaviour hang off
  `MODEL_IDS` (`src/niimbot.js:197-200`). Assuming a whole task family behaves alike
  is exactly what broke the B1 Pro in v1.3.3.
- **Comments are documentation and rot like it.** The header block at
  `src/niimbot.js:1-18` has already drifted from the code. If a change makes a
  comment false, fix it in the same commit or delete it.
- **User-visible changes bump the version and add a `CHANGELOG.md` entry in the
  same commit.** `CHANGELOG.md` (repo root, Keep a Changelog + SemVer) is the
  **release-notes** record and stays that way — pending work sits under
  `## [Unreleased]`. It is not a task log; the task queue is `docs/TASKS.md`.
- **`registry.json` is the model/label data**; the driver must stay
  application-agnostic and read models and sizes from the caller.
