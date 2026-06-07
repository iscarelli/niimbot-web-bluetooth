# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/), and this project adheres to
[Semantic Versioning](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/iscarelli/niimbot-web-bluetooth/compare/v1.3.4...HEAD
[1.3.4]: https://github.com/iscarelli/niimbot-web-bluetooth/compare/v1.3.3...v1.3.4
[1.3.3]: https://github.com/iscarelli/niimbot-web-bluetooth/compare/v1.3.2...v1.3.3
[1.3.2]: https://github.com/iscarelli/niimbot-web-bluetooth/compare/v1.3.1...v1.3.2
[1.3.1]: https://github.com/iscarelli/niimbot-web-bluetooth/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/iscarelli/niimbot-web-bluetooth/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/iscarelli/niimbot-web-bluetooth/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/iscarelli/niimbot-web-bluetooth/releases/tag/v1.1.0
