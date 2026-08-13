# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/), and this project adheres to
[Semantic Versioning](https://semver.org/).

## [Unreleased]
### Fixed
- **`IS_MAC` is `true` on an iPhone, and the 1.4.0 notes said the opposite.** The check
  (`src/niimbot.js:107`) falls back to matching `/Mac/i` against `navigator.platform`
  plus `navigator.userAgent`, and **every iOS user agent contains `"like Mac OS X"`** —
  so iOS matches. Measured on the device: the iPhone's connect line reads `mac=true`.
  Three consequences, all of them corrections rather than changes in behaviour:
  1. **Every iPhone print so far ran on the *paced* path**, not `"fast"`. The 1.4.0
     notes and README claimed the opposite and concluded that the macOS burst-drop is
     macOS-specific. **That conclusion had no basis** — the unpaced path has never run
     on iOS — and it is deleted, not softened.
  2. The short inter-label pause observed on the iPhone was attributed to BLE
     throughput. It is more likely `PACE_MS`.
  3. `FORCE_PACING` was redundant on iPhone from the start: `IS_MAC` already paced
     there. The feature is fine; its documented reason for existing was not.
  Whether iOS *needs* pacing is now an open question, and answering it needs an
  override that can force `"fast"` — which `FORCE_PACING`, being one-directional,
  cannot do.
- **`getStatus()` reported `ribbonInserted: true` in 1.4.0, and it was wrong.** The B1
  Pro is direct-thermal and has no ribbon at all, yet the field read `true` in every one
  of six real captures. It came from a niimbluelib offset that was never checked against
  a printer. **`ribbonInserted` and `ribbonRfidSuccess` are removed from `decoded`** —
  a field that is confidently wrong is worse than an absent one, and the bytes are still
  in `raw` for whoever settles them.
- `allPaper` is no longer exposed under that name. It read 276 on a roll holding 230
  labels and did not move across a print job, so it is not a paper total. It is now
  **`printLimit`**, marked `inferred`: on two different rolls `printLimit / capacity` is
  exactly 1.2, and the NIIMBOT Community Wiki's RFID tag map documents a "print limited
  cnt" — the consumable's DRM cap, provisioned at 120 % of nominal.

### Added
- **Demo: the label size is remembered per RFID barcode.** The tag identifies the roll
  but does not carry its dimensions (the official app looks them up on Niimbot's server),
  and picking the wrong size silently ruins labels. So the demo learns rather than
  guesses: on *Connect & identify* it reads `getStatus().decoded.rfid.barCode` and
  pre-selects the size that barcode was last **successfully printed** with, saying so in
  the log panel — a silent auto-selection is worse than none, because the user stops
  checking. On a miss it selects nothing. *Read status* reports the memory without moving
  the dropdown. If the tag's `consumablesType` disagrees with the selected model's
  `label_type` it **warns and stops there**: that field is marked `inferred`, so it is not
  solid enough to override the caller.
  **Nothing changed in `src/niimbot.js`** — this is application state, and the driver
  reads no config and owns no UI. The pattern (~20 lines, `localStorage`) is written up
  in README § *Demo* so another app can copy it. Never run against a real tag: the
  auto-select path is verified only from the console with hand-made status objects.
- **`Niimbot.WRITE_MODE` — the write-path override, now bidirectional.** `null` (auto,
  default) · `"fast"` · `"paced"` · `"acked"`; anything else **throws** instead of being
  silently ignored. Read **per write**, so it can be flipped on an open connection, and
  it never overwrites the DETECTED mode — `Niimbot.DETECTED_WRITE_MODE` and
  `Niimbot.EFFECTIVE_WRITE_MODE` expose both.
  This exists to make the open iOS question measurable: `IS_MAC` is `true` on an iPhone,
  so iOS has only ever printed **paced**, and 1.4.0's `FORCE_PACING` could only force
  pacing *on*. Forcing `"fast"` on an iPhone and looking at the paper is the experiment —
  README § *iOS coverage* has the procedure.
  Forcing `"fast"` on a model `MODEL_IDS` marks `paced` (the 203 dpi B1) **logs a warning
  and is still obeyed**: that combination is a diagnostic, not a setting, and a driver
  that refused it would block the measurement it exists to enable.
- **The connect summary line is no longer gated behind `DEBUG`**, and now reads
  `writeMode=<detected> override=<…> effective=<…>` next to the existing
  `forcePacing=`/`bundle=`/`mac=`/`pace=` fields. Which path a print took was previously
  visible only with the packet dump on — which buries it — and that invisibility is how
  1.4.0 shipped a wrong conclusion about iOS. Setting `WRITE_MODE` logs the new effective
  mode too. One line per connect; everything else stays behind `DEBUG`.
- Demo: the `FORCE_PACING` checkbox is replaced by a **Write mode selector** (auto /
  fast / paced / acked). A native `<select>` with a 44 px tap target and 16 px type —
  one-handed on a phone, which is the device the iOS measurement runs on.
- `test/pacing.test.js` now drives **all four override positions** against a fake
  characteristic: no gap for `"fast"`, ~`PACE_MS` for `"paced"`, `writeValueWithResponse`
  for `"acked"`, and the detected behaviour for `null` (checked on both a `paced: false`
  and a `paced: true` model, so an always-pacing driver would fail it). It also asserts
  the invalid-value throw, the pacing warning firing only where it should, the
  `FORCE_PACING` alias round-tripping in both directions, and that the detected mode is
  never mutated by an override. No printer involved.
- **The `getStatus()` decode is now grounded in real B1 Pro captures**, and `decoded`
  carries an **`evidence` map** marking every field `"observed"` (moved on hardware here,
  exactly as named), `"varies"` (moved, meaning unsettled) or `"inferred"` (not confirmed
  here). `lidClosed`, `paperInserted`, `paperRfidSuccess`, `usedPaper` and `capacity` are
  **`"observed"` on the B1 Pro (model id 4097) only** — on any other model, including the
  B1 and M2-H which have never been captured, every field falls back to `"inferred"`,
  because lid-closed polarity is documented to be inverted on some printers.
  `confidence` gains the value **`"validated"`** as a coarse floor over that map;
  `{ raw, decoded, confidence }` and the exactness of `raw` are unchanged.
- `temp` is kept and marked `"varies"`: it read 72 idle, 73 just before a job and 74
  right after three labels, so it tracks something thermal — but 72–74 is high for °C on
  a lightly-used printhead, so the unit is not claimed.
- `Niimbot.readiness(status)` — a **pure reporter** over a `getStatus()` result:
  `{ ready, reasons, evidence }`, where `ready` is `null` when it cannot tell rather than
  collapsing that into "not ready". It is deliberately **not wired into any print path**;
  no print path calls `getStatus()` or branches on it, validated fields or not.
- `test/status.test.js` now runs the **six recorded B1 Pro heartbeats and both recorded
  RFID payloads as fixtures**, asserting each field against the physical state written
  down beside it, that the ribbon fields cannot return, that no error field is invented
  from `idx1`, and that the hardware claim does not leak to model 4096.

### Deprecated
- `Niimbot.FORCE_PACING` is now an **alias over `WRITE_MODE`** and keeps working — it is
  published API as of 1.4.0 and is **not** removed. Reading it is `WRITE_MODE ===
  "paced"`; `= true` sets `"paced"`; `= false` clears the override to `null`. One sharp
  edge, documented in the source and in the README: `= false` also clears a `"fast"` or
  `"acked"` override, because a boolean cannot express "not paced, but keep that". Prefer
  `WRITE_MODE`.

### Changed
- The comment above `IS_MAC` (`src/niimbot.js`) claimed an iPhone "reports `iPhone` and
  is NOT matched". That is **false** — it matches via the user agent's `"like Mac OS X"`
  — and the comment was the stated reason `FORCE_PACING` existed. Replaced with what is
  true: iOS is paced by default, and whether it needs to be is unmeasured.
- `idx1` of the Advanced2 heartbeat is **not decoded**. Reading its low nibble as an
  error code (`0` none / `8` lid open / `3` out of paper) fit four captures and was
  refuted by a fifth taken right after a clean print. `docs/protocol-v4.md` records the
  refuted hypothesis on purpose, so it is not re-derived.
- `docs/protocol-v4.md` § *Consumable status* replaces the inferred offset tables with
  the capture tables they were checked against, keeps the observed and still-inferred
  parts visibly separate, and cites the NIIMBOT Community Wiki for the inverted-lid
  hazard and the tag's print-limit counter.

## [1.4.0] - 2026-08-11
### Added
- `Niimbot.getStatus()` — consumable status (lid closed, paper inserted, charge level,
  RFID read state, and the RFID tag's uuid/barcode/serial/paper counts) read from
  `Heartbeat 0xDC[04]` and `RfidInfo 0x1A[01]` on an already-connected printer.
  ⚠ **The decode is UNVALIDATED: the field offsets are transcribed from niimbluelib and
  have never been checked against a real printer.** It is reported as
  `confidence: "inferred"` (there is no `"validated"` value yet) and it is **advisory
  only — no print path calls it and the driver never branches on it**, because a
  wrongly-decoded `paperInserted` refusing a job into a loaded printer would be worse
  than shipping no status at all. Do not gate printing on it.
  What is *not* a guess is `raw`: the exact response bytes are always returned intact,
  an unrecognised payload yields `decoded: null` / `confidence: "unknown"` instead of a
  half-filled object, and a printer that never answers `RfidInfo` (normal on many
  models/consumables) yields `rfid: null` rather than an error.
- Demo: a **Read status** button that hex-dumps those raw bytes into the log panel.
  Capturing a dump next to what the printer physically shows (lid, paper, tag) is the
  step that will settle the layout and turn the decode from inferred into validated.
- `test/status.test.js` — harness driving `getStatus()` against a fake characteristic
  (known layout, unknown length, silent RFID, malformed/truncated RFID), and asserting
  that the driver never calls `getStatus()` itself. No printer involved: it proves the
  decoder matches the transcribed layouts, not that a printer sends them.
- `docs/protocol-v4.md`: a *Consumable status* section with the request/response
  opcodes, payload lengths and field offsets — explicitly marked as inferred from
  niimbluelib and not confirmed on hardware here.
- `Niimbot.FORCE_PACING` (default `false`) — forces the paced write path on a model or
  platform the driver detected as `"fast"`. It is read **per write**, so it can be
  flipped on an already-open connection, and the detected `writeMode` is left intact
  for logging.
  ⚠ The stated rationale — that it covers an iPhone, which `IS_MAC` supposedly misses —
  **was wrong**: `IS_MAC` is `true` on iOS. See the correction under *Unreleased*. The
  feature works as described; only its justification was false.
- The connect log line now reports `forcePacing=<bool>` next to `writeMode=` and `mac=`.
- Demo: an on-screen **log panel** (collapsible, monospace, wraps instead of widening the
  page) that mirrors `console.log`/`console.error` — including the driver's `writeMode=`
  line — by wrapping the console methods before the driver loads; calls still reach the
  real console. A phone has no console, so this is the only place a mobile tester can
  read that line. It carries a **Copy log** button (clipboard, with an `execCommand`
  fallback outside a secure context), a **Clear** button, and checkboxes for
  `Niimbot.FORCE_PACING` and `Niimbot.DEBUG` (off by default, so the packet dump does not
  bury `writeMode=`). Demo errors now go to the panel as well as the status line.
### Changed
- README: documented `Niimbot.FORCE_PACING` in the API list, added a per-platform
  support table (Android's location-services gate for BLE scanning; iOS needs a
  polyfilling browser such as Bluefy, since Safari has no Web Bluetooth), and an
  *iOS coverage* section recording exactly what was tested.
- **iPhone validated on the B1 Pro via Bluefy (2026-08-11): single label and the
  5-dense-label stress run both print.** Still untested on iOS: B1 and M2-H (the
  frame-bundling models).
  ⚠ This entry originally went on to claim that iOS printed in `"fast"` mode and that
  the macOS burst-drop is therefore macOS-specific. **That was wrong** — see the
  correction under *Unreleased*. The false sentences are deleted rather than patched;
  what remains above is what was actually observed.
- Corrected two false claims in the `src/niimbot.js` header comment: the driver does
  `fetch` the image URL and rasterize it on an offscreen `<canvas>` (it owns no UI and
  reads no config, which is what was meant), and Web Bluetooth on Safari/iOS is now a
  polyfill route rather than a flat "does not exist".

## [1.3.5] - 2026-06-07
### Added
- README: a "Real-world use" GIF (the driver printing real labels in a production app)
  and a Troubleshooting section (macOS blank prints → `PACE_MS`, model-mismatch errors,
  dense/BLE tuning, Web Bluetooth support, `DEBUG`). Docs only — no code change.

## [1.3.4] - 2026-06-07
### Fixed
- **macOS:** dense/batch prints came out **blank** on the B1 Pro (and other "fast"
  models) while still reporting 100% — macOS CoreBluetooth silently drops the unacked
  `writeValueWithoutResponse` bursts that Windows tolerates, so the image rows never
  arrived (control packets use waited writes, so progress still advanced). On macOS the
  driver now paces the "fast" models too (one frame per write + a gap).
### Added
- `Niimbot.PACE_MS` — runtime-tunable gap (ms) between unacked writes (default 10).

## [1.3.3] - 2026-06-07
### Fixed
- **B1 Pro regression:** dense/stress batches showed "printing" but nothing came out.
  Frame bundling (added in 1.2.0, validated only on the B1 and M2-H) is not tolerated
  by the B1 Pro. Bundling is now **per-model** (`MODEL_IDS.bundle`), enabled only where
  validated; the B1 Pro (and unidentified models) revert to one frame per BLE write.
### Added
- README demo GIF.

## [1.3.2] - 2026-06-07
### Removed
- Dropped the unused `printhead` field from the `MODEL_IDS` table in `src/niimbot.js`.
  The driver never read it (the print width comes from each registry size's `w_px`),
  and a single per-model figure invited confusion with label width — e.g. the B1 Pro
  50×30 renders at 584 px even though its printhead is 567 px. No behavior change.

## [1.3.1] - 2026-06-07
### Fixed
- `registry.json`: removed a stale `_untested` marker on the `T50x30_m2h` size — the
  Niimbot M2-H and its 50×30 size are validated; replaced with a `_note` documenting
  the 567 px printhead derivation, and updated the registry header comment. No code or
  behavior change.

## [1.3.0] - 2026-06-07
### Added
- **Niimbot M2-H** support (`b1` task, 300 dpi, model id 4608) — validated on real
  hardware. Uses the B1 command sequence with fast (unacked) writes.
- **Automatic model identification** on connect (model id `0x40[08]` + protocol version
  `0xA5`), exposed as `Niimbot.printer`; `Niimbot.identify(model)` returns it without
  printing; `Niimbot.disconnect()` to swap printers. The driver refuses to print on a
  model/`task`/`dpi` mismatch.
- **Per-model flow control** — only the 203 dpi B1 paces its writes; the 300 dpi B1 Pro
  and M2-H burst.
- Live demo on GitHub Pages, `package.json` (zero-dependency, published to npm), and
  README badges + supported-printer table.
### Fixed
- M2-H printed at ~30 s/page because it exposes the `write` property and fell into slow
  write-with-response; the `b1` path now always prefers fast/paced unacked writes.

## [1.2.0] - 2026-06-07
### Added
- **Niimbot B1** support (`b1` task, 203 dpi, protocol 3): post-connect handshake,
  `PrintStart 7b` / `PageStart` / `SetPageSize 6b`, total-mode rows, status poll.
- `copies` — print N identical labels from a single upload (the printer repeats it).
- Frame bundling — several row frames per BLE write, so dense pages stream without
  stalling between labels.
- Print-position calibration (`offset_y_px`).
### Changed
- B1 prints a batch as one continuous job of N pages (no retract between labels),
  matching the B1 Pro path; row pacing aligned to 10 ms.

## [1.1.0] - 2026-06-05
### Added
- Initial public release: zero-dependency Web Bluetooth driver for the **Niimbot B1 Pro**
  (`v4`, 300 dpi), reverse-engineered protocol V4 documentation, and a standalone demo.
- Multi-label batches print as one continuous job (no stop/retract between labels).

[Unreleased]: https://github.com/iscarelli/niimbot-web-bluetooth/compare/v1.3.5...HEAD
[1.3.5]: https://github.com/iscarelli/niimbot-web-bluetooth/compare/v1.3.4...v1.3.5
[1.3.4]: https://github.com/iscarelli/niimbot-web-bluetooth/compare/v1.3.3...v1.3.4
[1.3.3]: https://github.com/iscarelli/niimbot-web-bluetooth/compare/v1.3.2...v1.3.3
[1.3.2]: https://github.com/iscarelli/niimbot-web-bluetooth/compare/v1.3.1...v1.3.2
[1.3.1]: https://github.com/iscarelli/niimbot-web-bluetooth/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/iscarelli/niimbot-web-bluetooth/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/iscarelli/niimbot-web-bluetooth/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/iscarelli/niimbot-web-bluetooth/releases/tag/v1.1.0
