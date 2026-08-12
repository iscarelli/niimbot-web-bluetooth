# Tasks

Strict execution order — always take the **topmost** open task. Retiring a task
means removing it here **and** logging the change under `## [Unreleased]` in
`CHANGELOG.md` (repo root), plus closing its Vikunja mirror card.

Read `CLAUDE.md` first — especially *The verification that matters is physical*.
Neither task below may claim a print path works; both are verifiable without a
printer, and hardware confirmation is the maintainer's separate step.

## Active

## [ ] T-001  Runtime override for write pacing
Why:     Today the paced/fast choice is decided once, from OS detection, and cannot
         be changed from outside — so when a page prints blank on a platform the
         driver doesn't know about (iPhone, right now), there is no way to even test
         the fix without editing the driver.
Vikunja: 941
Files:   src/niimbot.js, README.md
Do:
  1. Add a public `Niimbot.FORCE_PACING` boolean (default `false`), exposed with a
     getter/setter in the `root.Niimbot` object at `src/niimbot.js:516-527`,
     alongside `PACE_MS` and `BUNDLE_MAX`.
  2. Make it apply **at write time, not at connect time**, so it can be toggled on
     an open connection without reconnecting. In `writeRaw` (`src/niimbot.js:110`)
     compute the effective mode instead of reading `writeMode` directly:
     a `"fast"` mode becomes `"paced"` when `FORCE_PACING` is true; `"acked"` and
     `"paced"` are unchanged. Do not mutate the `writeMode` variable itself — the
     detected mode must stay readable for logging.
  3. Include `forcePacing=<bool>` in the existing connect log line
     (`src/niimbot.js:280`), next to `writeMode=` and `mac=`.
  4. Document `Niimbot.FORCE_PACING` in the README API list, next to
     `Niimbot.PACE_MS` — one line: what it does and when you'd reach for it (a
     platform the driver doesn't detect drops unacked bursts).
  5. In the README's *iOS coverage* section, replace the sentence saying there is
     **no runtime workaround** — that becomes false the moment this ships. It should
     now say: set `Niimbot.FORCE_PACING = true` before printing and re-run.
  6. Same file, fix two stale comments this work sits on top of:
     `src/niimbot.js:8` claims the driver "never touches the DOM nor fetches any
     config", but `imageToPacked` calls `fetch` (`:309`) and
     `document.createElement` (`:310`) — reword to what is actually true (it reads
     no config and owns no UI). `src/niimbot.js:17-18` says Web Bluetooth "does not
     exist on Firefox/Safari" — Firefox is right, Safari now has the polyfill route;
     point at the README instead of restating it.
Verify:
  - `node --check src/niimbot.js` passes.
  - A Node harness under `test/` that stubs `globalThis.navigator` **before**
    requiring the file (see CLAUDE.md), builds a fake characteristic recording the
    timestamp of each `writeValueWithoutResponse` call, and drives `writeRaw`
    indirectly. Assert both directions: with `FORCE_PACING = false` and a `"fast"`
    mode the writes have no gap; with `FORCE_PACING = true` they are spaced by
    ~`PACE_MS`. A test that only proves the true case would pass against a driver
    that always paces — assert both or the check is blind.
  - Report explicitly that no printer was involved.

## [ ] T-002  On-screen log panel in the demo
Why:     The driver's diagnostics go only to `console.log`, and a phone has no
         console — so the one number you need on mobile (`writeMode=…`) is
         invisible on exactly the platform whose behaviour is unknown. This is what
         blocked confirming the iPhone dense-print path.
Vikunja: 942
Files:   demo/index.html
After:   T-001
Do:
  1. Add a collapsible log panel to the demo page (a `<details>` with a monospace
     `<pre>` is enough — no framework, no dependency, matching the page's existing
     plain style). It must be readable on a narrow phone screen: wrap or scroll
     horizontally, never widen the page.
  2. Mirror `console.log`/`console.error` into it by wrapping the console methods
     on page load, so the driver's existing `logMsg` output is captured without
     touching `src/niimbot.js`. Keep passing the calls through to the real console.
  3. Add a **Copy log** button (`navigator.clipboard.writeText`), so a mobile
     tester can paste the trace into an issue — reading it off a phone screen is
     the whole problem.
  4. Add a checkbox wired to `Niimbot.FORCE_PACING` (from T-001) and one to
     `Niimbot.DEBUG`, so a mobile tester can flip both without a console.
  5. Default `Niimbot.DEBUG` to off; the panel is useless if the packet dump
     drowns the `writeMode=` line.
Verify:
  - `node demo/serve.mjs`, open `http://localhost:8080/demo/` in Chrome, and with
    **no printer connected** click *Connect & identify printer* then dismiss the
    chooser: the panel must already show the driver's version line, and the
    resulting error must appear in the panel, not only in the console.
  - Narrow the window to ~380 px (or use device emulation) and confirm the page
    does not scroll horizontally.
  - Confirm *Copy log* puts the panel's text on the clipboard.
