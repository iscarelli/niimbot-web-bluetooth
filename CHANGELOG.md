# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/), and this project adheres to
[Semantic Versioning](https://semver.org/).

## [Unreleased]

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
  for logging. The escape hatch for a platform `IS_MAC` doesn't cover: an iPhone is
  CoreBluetooth too but reports `navigator.platform === "iPhone"`, and until now
  forcing pacing there meant editing the driver.
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
  5-dense-label stress run both print**, the dense run with a short inter-label pause
  (BLE throughput, not a fault). This was the open question, and the result is the
  opposite of the expected one: the macOS blank-print burst drop **did not** occur on
  iOS in `"fast"` mode, so that failure is specific to **macOS**, not to CoreBluetooth
  in general — `IS_MAC` correctly stays `false` on iPhone. `FORCE_PACING` therefore
  ships as the diagnostic for this class of failure, not as a setting iOS requires.
  Still untested on iOS: B1 and M2-H (the frame-bundling models).
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
