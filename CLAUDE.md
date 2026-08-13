# niimbot-web-bluetooth — project rules

Zero-dependency Web Bluetooth driver for Niimbot label printers, published to npm
and served as a live demo from GitHub Pages. One source file: `src/niimbot.js`.

## Verify commands

There is **no build, no bundler, no test suite and no linter** — do not invent one.
Verification is:

```bash
node --check src/niimbot.js     # syntax only; the cheapest gate, always run it
node demo/serve.mjs             # then open http://localhost:8080/demo/index.html in Chrome
```

For logic that can be exercised without a printer, write a throwaway Node harness
that stubs the browser globals (`globalThis.navigator` must exist **before** the
file loads — `IS_MAC` at `src/niimbot.js:107` reads `navigator.platform` at load
time and throws in bare Node; on Node ≥ 21 `navigator` is a getter-only global, so
replacing it takes `Object.defineProperty`). Keep such harnesses under `test/`;
`package.json` `files` whitelists what ships, so `test/` never reaches npm.

```bash
node test/pacing.test.js        # WRITE_MODE override harness: write spacing + write method (no printer)
node test/status.test.js        # getStatus() decode harness (no printer)
node test/unconfirmed.test.js   # a job the printer never confirmed must reject (no printer)
node test/label-memory.test.js  # barcode→record storage (no printer, no browser)
node test/label-size.test.js    # mm→px geometry (no printer, no browser)
```

The demo's inline `<script>` cannot be checked by `node --check`. To parse it, extract
the non-`src` script blocks and check each — that is a syntax gate, not a functional one,
and it does not license claiming the demo works:

```bash
python - <<'PY'
import io, re, subprocess
s = io.open("demo/index.html", encoding="utf-8").read()
for i, b in enumerate(re.findall(r'<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>', s, re.S)):
    io.open("/tmp/b%d.js" % i, "w", encoding="utf-8").write(b.replace("<\\/script>", "</script>"))
    print(i, subprocess.run(["node", "--check", "/tmp/b%d.js" % i]).returncode)
PY
```

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
  `MODEL_IDS` (`src/niimbot.js:208-211`). Assuming a whole task family behaves alike
  is exactly what broke the B1 Pro in v1.3.3.
- **Comments are documentation and rot like it.** The header block at
  `src/niimbot.js:1-21` had already drifted from the code once (two false claims,
  corrected in T-001). If a change makes a comment false, fix it in the same commit
  or delete it.
- **Changelog on every retired task; version bump only at release.** A user-visible
  change adds its `CHANGELOG.md` entry under `## [Unreleased]` **in the same commit**
  — never reconstructed later from `git log`. The version in `package.json` and
  `VERSION` (`src/niimbot.js`) is bumped **separately, when releasing**, which is
  when `## [Unreleased]` becomes `## [x.y.z] - YYYY-MM-DD`. An implementer therefore
  does **not** bump the version; releasing is the maintainer's step (it also tags and
  publishes to npm). `CHANGELOG.md` (Keep a Changelog + SemVer) is the release-notes
  record, not a task log — the task queue is `docs/TASKS.md`.
- **`registry.json` is the model/label data**; the driver must stay
  application-agnostic and read models and sizes from the caller.
