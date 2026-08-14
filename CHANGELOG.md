# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/), and this project adheres to
[Semantic Versioning](https://semver.org/).

## [Unreleased]
### Added
- **`registry.json` ships `T40x60`** — 40 × 60 mm at 300 dpi (472 × 709), from a roll on
  the maintainer's B1 Pro (tag `6972842748560`, `printLimit` 150 / `capacity` 125 = **1.2**,
  the same ratio as every roll measured here). It is now the largest size that ships, and
  its `_note` says what that costs: 709 rows is double a 50×30, so on a Mac — where the
  driver paces at 10 ms per write — the demo's *stress* label took **7.0 s to upload
  against 1.1 s to print**.
- **A "Print realistic label" button** — *confirmed on paper 2026-08-14* — because that
  7.0 s is not what a real label costs and the demo had no way to show the difference. It draws what people actually print —
  frame, heading, two data lines, a barcode band, a timestamp — where every band is a run
  of identical rows and run-length does its job. The stress label's corner-to-corner
  diagonals touch nearly every row and defeat it entirely (589 writes for 709 rows, one
  per row). Same print path, same options; the status line reports size, density, write
  mode and elapsed seconds, so two labels or two write modes can be compared honestly.
  Its layout is fractions of `h_px` and **throws rather than clipping** if a block will
  not fit, on both axes — a canvas drops out-of-bounds pixels without a word, which had
  already cost one label's descenders and would silently halve a heading on a 144 px-wide
  15 mm label.
- **The Rolls panel reuses a shipped size when the geometry is identical** instead of
  saving a private copy of it. Registering four rolls by hand had produced `C50x30_300`,
  `C25x38_300` and `C30x45_300`, byte-identical to `T50x30`, `T25x38` and `T30x45`: the
  picker showed each twice, one starred and one not. Duplicates print correctly, so the
  cost only lands later — when the shipped entry is corrected, the copy keeps the old
  pixels and still looks official. Matching is on `dpi` + `w_px` + `h_px`, because the
  pixels are the identity; the roll's name and colour still attach to its barcode.
- **The demo has a Density picker (1–5)**, next to Model and Label, feeding every print
  button. It starts at the selected model's default (marked *model default* in the list)
  and **resets when the model changes**, because a heat value chosen for one printer means
  nothing on another. Until now the option existed only in the API, so the only way to try
  it was a console snippet.
- **README documents what density actually costs and how to check it**, rather than only
  its signature: the printer stores it *and* slows down for it, so a higher value is a
  slower print, per label. Also warns against the test everyone reaches for first —
  comparing solid black, which cannot show a difference — and points at the step-wedge
  target in `docs/NOTES.md`.
- **The demo shows which driver version it is actually running**, as a badge next to the
  title (it was already in the tab title and the console, where nobody looks). A tab left
  open across a deploy keeps the driver it loaded — the `?t=` cache-buster is resolved at
  page load and cannot help a page nobody reloaded — and a stale tab does not fail, it
  succeeds at being slightly old. On 2026-08-14 one silently ignored the just-shipped
  `density` option, printed five identical labels, and the missing effect was very nearly
  written up as printer behaviour.
- **`0x40[0x01]` → `0x41` is the density, and it reads back what you set** — measured on a
  D11_H (`03` → set 1 → `01` → set 5 → `05` → set 3 → `03`), not taken on faith from an
  enum. That makes the density round-trip checkable from the console with `probe()` and no
  labels at all; see `docs/NOTES.md`. What density does *to the paper* is still unmeasured —
  it needs a target that can show it (hairlines, small text, a halftone ramp) rather than
  the solid black that was tried first, since a fully burned dot cannot get blacker.

## [2.1.0] - 2026-08-13
### Fixed
- **Connecting with no `name_prefixes` now discovers instead of finding nothing.** It
  fell back to `{ services: [SVC_UUID] }`, which looks like a discovery filter and is
  not: it matches the service UUID **as advertised**, and these printers do not advertise
  it — the service only appears after connecting. Measured 2026-08-13: the chooser came
  up empty for a D11 *and* for a B1 Pro, a printer this driver prints with daily. A
  filter that cannot find hardware we own is a dead end, so no prefix now means
  `acceptAllDevices` — the path a printer the registry does not know yet actually needs.

### Added
- **`density` is a per-print option now (1–5), not a per-model constant.** The official
  app exposes the same 1–5 scale; the driver had it hard-wired to whatever
  `registry.json` said for the model, so a caller could not turn it up for stock that
  needs more heat. `printImage`/`printBatch` take `density`, falling back to the model's
  value. It is **validated before the printer is touched** — an out-of-range value throws
  and *nothing* is written, asserted in `test/unconfirmed.test.js`, because this is the
  one setting that controls how hard the printhead burns. Strings are accepted (`"4"`),
  since an HTML `<select>` yields them.
  **No model has had its density verified on paper, and the one attempt was inconclusive.**
  Five solid-black labels printed on a D11_H at densities 1…5 came out *identical* — which
  is exactly what you would expect both if the printer ignored the setting and if the test
  was blind to it, because solid black is saturated and cannot get blacker. `docs/NOTES.md`
  has the discriminator, and it costs no labels: read the value back with `0x40[0x01]`
  after setting it. So the guarantee here is narrow and worth stating plainly — the driver
  **sends** what the caller asks for; what the printer does with it is unmeasured.
- **The D11_H is registered — model only, deliberately no size yet.** Found by open
  discovery (it advertises `D11_H-…`), **model id 528, protocol 5**, and the `v4` command
  sequence prints on it: solid black came out on the first attempt, which is what
  `docs/protocol-v4.md` predicted and nobody had tried. Added to `registry.json` and to
  `MODEL_IDS`, with `paced`/`bundle` left at the conservative defaults because neither
  was measured.
  **No size entry**, on purpose: the printable width is unresolved. The protocol doc says
  136 px, a byte in the `dc[3]` response reads 144, and the first print agrees with
  neither. Shipping a `w_px` now would repeat exactly the mistake this changelog spent
  the day undoing — a plausible number with an invented justification.
  Its status response is another new shape: `0xB3` is **8 bytes** here, against 11 on the
  B1 Pro and 10 on the M2-H.
- **`printLimit` confirmed on a third roll, and the best one yet.** The D11_H's tag reads
  `printLimit` 252 with **no `capacity` field**, and the maintainer's roll holds **210**
  labels — 252 / 210 = **1.2 exactly**, the same ratio seen on two earlier rolls. On
  those, both numbers came from the tag; here the denominator came from outside it.
- **`Niimbot.probe(cmd, data, timeoutMs)` — a diagnostic, not API.** Sends one command
  and returns whatever answers, accepting any response opcode. Added while hunting where
  the M2-H reports remaining ribbon: with a nearly-full ribbon and a half-spent one,
  **every** response the driver already collects is byte-identical — the whole b1
  handshake, `0xA5→0xB5`, all eight `0x40` info reads, the heartbeat and the RFID
  payload. The only byte that moved is the heartbeat's `d[1]`, which drifts on its own
  (it changed with nothing touched at all). So the figure the official app shows comes
  from something nobody here asks for, and asking is the only way to find it.
  Nothing in the driver calls it. **Sweep sub-codes, not top-level opcodes:** this
  protocol has commands that print, feed, write RFID and update firmware.
  It earned its keep immediately, with a **negative result**: the same sweep run with
  a half-spent ribbon and a new one is byte-identical across `0x1A[01..05]`,
  `0x40[00..20]`, `0xDC[01..05]` and `0xA5`. Remaining ribbon is not readable from
  this driver — see `docs/NOTES.md`. A caller can know whether a ribbon is fitted,
  not how much is left.
- **`getStatus().decoded.heartbeat.ribbonInserted` is back**, at a different offset from
  the one 2.0.0 removed. That removal was right — the old offset read `true` on a
  direct-thermal B1 Pro, which has no ribbon slot. `d[7]` is where the field actually
  lives, established by the only evidence that settles such a thing: an **A/B on one
  printer**, ten seconds apart, with nothing changed but the ribbon.

      M2-H, ribbon in:  1f 5d 04 4b 00 00 01 [01] 00 00 00
      M2-H, ribbon out: 1f 5e 04 4b 00 00 01 [00] 00 00 00

  Consistent with the B1 Pro's six captures (no ribbon, `d[7] = 00`). Marked `observed`
  **only on model 4608 with the 11-byte layout** — the printer and layout the A/B ran on.
  Any other model decodes the byte but gets `inferred`, however suggestive it looks:
  agreeing with a printer that *has* no ribbon cannot confirm an offset. Covered by
  `test/status.test.js` (r1), which also asserts the claim does not leak.
  **`ribbonRfidSuccess` did NOT come back** and the harness still forbids it: unlike
  `ribbonInserted`, nothing has been measured for it.

### Changed
- **README: pair a size with the MODEL, not just the dpi.** The registry ships two
  300 dpi 50×30 entries — `T50x30` (584, B1 Pro) and `T50x30_m2h` (567, M2-H) — so a
  caller filtering by dpi is offered both, and picking wrong is silent: the printer
  prints columns `0 … W-1` and drops the rest with no error. Also states what 567
  actually is, since the old note got it wrong: the M2-H is **thermal transfer (ribbon)**
  and 567 is a deliberate ~1.4 mm margin for ribbon drift, not a printhead limit — its
  head reaches at least 584 (solid black at 584 printed edge to edge, 2026-08-13).
- **Corrected a comment that promised continuous streaming.** The header block said a
  batch "streams continuously with no stop between labels". Measured on a B1 Pro,
  2026-08-13, with the packet trace: in `"paced"` a dense page takes ~3 s to send
  (~255 row-writes × `PACE_MS` 10 ms) while the printer finishes printing one in less,
  so it idles between labels and the pause is visible on the paper path. The look-ahead
  hides latency; it cannot create bandwidth. The claim holds in `"fast"`, not in
  `"paced"` on dense content — behaviour unchanged, the comment now says which.
- **The connect line now says WHY `IS_MAC` decided what it decided.** It reads
  `mac=false [uaData="Windows" platform="MacIntel"]` instead of a bare `mac=false`.
  On 2026-08-13 the same Chrome on the same Mac logged `mac=true` in one session and
  `mac=false` in another. `IS_MAC` is computed once at load, so the difference had to be
  in what `navigator` reported — but the log printed only the conclusion, and working
  back from a lone boolean cost hours and produced two wrong claims about which machine
  had been used. The bracket shows the inputs, so a contradiction between them
  (`uaData` saying one platform while `platform` says another — device emulation, a
  privacy extension, a spoofed agent) is visible at a glance. The decision logic is
  unchanged; only its provenance is now on the record.
- `registry.json`: the `T25x38` cable flag is **confirmed on paper** (2026-08-13, B1 Pro,
  on a Mac so the write path was `paced`). It shipped in 2.0.0 with a `_note` saying the
  geometry was arithmetic plus the `T30x45` precedent; that note now records the
  measurement instead. Two consecutive labels printed correctly, filling the flag with no
  right-edge loss, and the second registered properly — so the flag-only `h_px`
  convention holds on a second consumable, not just the one it was derived from.
  The 2.0.0 notes below are left as they were: they described the state at release, and
  a changelog is a record, not a live document.

## [2.0.0] - 2026-08-13
### Fixed
- **A job the printer never confirmed no longer resolves as success.** ⚠️ **Behaviour
  change:** `printImage` and `printBatch` now **reject** when the print was not
  confirmed. Measured on hardware 2026-08-13: a 5-label batch printed **four** labels,
  every one carrying the first label's content, and the driver logged `all 5 pages
  printed` and resolved `"ok"`. Two independent silent failures allowed it, and both are
  fixed:
  - `waitPage` fell out of its 25 s loop and `return`ed exactly as it did on success, so
    *printed* and *gave up* were the same answer. It returns a boolean now, and remembers
    the last counter value so the failure can say **where** it stalled.
  - the PageEnd ack was discarded, so `page N: buffered (PageEnd acked)` was logged
    directly beneath the `⚠ no response to e3` warning saying it was not.
  **PrintEnd is still sent before the rejection** — it is what feeds out and retracts the
  paper, so skipping it would leave the label under the printhead. The error says so, and
  names the numbers (`printer counter stopped at page 4 of 5 after 25000ms`), because
  "print failed" would repeat the mistake this fix exists to correct. A batch also stops
  streaming further pages once a page goes unconfirmed.
  New `Niimbot.PAGE_WAIT_MS` (default `25000`) exposes the deadline. Covered by
  `test/unconfirmed.test.js`, which asserts the **order** of the writes — "PrintEnd was
  sent" and "PrintEnd was sent first" are different claims and only the second protects
  the paper.
  Callers that ignored the resolved value need no change; callers that treated resolution
  as "it printed" were being told something untrue and should now handle the rejection.
- **A printer that went quiet crashed `getStatus()` instead of returning nulls.** Found
  on real hardware, 2026-08-13. The heartbeat is requested with `wantResp = null` —
  "accept any response opcode" (`src/niimbot.js:574`) — and the timeout **warning**
  formatted that null as hex, so `h2(null)` threw
  `Cannot read properties of null (reading 'toString')` (`src/niimbot.js:233`). The
  documented soft path (`raw.heartbeat: null`, `decoded: null`,
  `confidence: "unknown"`) was therefore unreachable: the driver **threw while trying to
  report that nothing answered**. Repeated status polls do go unanswered on a real B1
  Pro, so this was the ordinary case, not an exotic one. `h2` now renders a missing
  opcode as `—` and the warning says `wanted any`. Covered by a regression case in
  `test/status.test.js`.
- **Demo: *Read tag* now waits longer and retries once.** The same hardware drops
  `RfidInfo` answers when polled in quick succession — a tag that read fine returned
  nothing 3 s later. The driver's 600 ms default is tuned for not hanging a connect;
  this button is a deliberate request where the user will wait, so it uses 1500 ms and a
  single retry before declaring there is no roll.
- **`IS_MAC` is `true` on an iPhone, and the 1.4.0 notes said the opposite.** The check
  (`src/niimbot.js:127`) falls back to matching `/Mac/i` against `navigator.platform`
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
  Whether iOS *needed* the pacing was left open here, and `WRITE_MODE` (below) was
  built to settle it. **It is settled, on paper, 2026-08-13:** the same 5-dense-label
  batch on an iPhone printed 4 labels with a truncated raster under `"fast"` and 5
  correct ones under `"paced"`. **iOS drops unacked writes like macOS**, so the
  `IS_MAC` pacing is right on iOS — by accident of the user-agent match, but right.
  See README § *iOS coverage* for the run and the failure signature.
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
- **`registry.json`: two cable-flag sizes, `T30x45` and `T25x38`.** Both are 300 dpi
  (B1 Pro). `h_px` covers the **flag only**, not the transparent tail — measured
  2026-08-13, the printer registers on the gap itself, so a short `h_px` prints the flag
  and still advances correctly (`docs/NOTES.md` § *Cable flags*). `T30x45` printed
  correctly on paper; **`T25x38` has not** — its geometry is arithmetic plus the `T30x45`
  precedent, and its `_note` says so.
- **`src/label-memory.js` — the barcode→label memory as an optional file.** It was ~40
  lines living only in the demo, so every app that wanted it retyped them (and retyped
  the `localStorage` guards it would get wrong). It cannot live in the driver, which
  stays application-agnostic, so it ships as its own `<script>`: loading it is the
  opt-in, and it never references `Niimbot`, so load order does not matter.
  `NiimbotLabelMemory.create({ key, storage })` — **`key` is required with no default**,
  because two apps on one origin share one `localStorage` and this project's own Pages
  site hosts more than one page. `storage` is injectable, which is what lets it be
  tested in Node with no browser.
  The stored value is now a **record** (`{ size, color, … }`), not a bare size id: the
  RFID tag carries no colour — the payload is fully accounted for with zero spare bytes
  (`src/niimbot.js:485-486`) — so colour is application data and belongs here. Data
  already on a device is **normalised on read, never rewritten in bulk**: a stored bare
  string reads back as `{ size }`, and `remember(bc, "T50x30")` still works.
  `seed(table)` bulk-loads a hand-written table and **fills gaps only** by default —
  hand-typed must not silently overwrite what a real print taught.
- **`src/label-size.js` — millimetres to `SetPageSize` pixels**, also optional, also
  zero-dependency, pure arithmetic with no DOM and no storage.
  `sizeFromMm({ w_mm, h_mm, dpi, printhead_px })` → `{ w_px, h_px, stride, clamped }`.
  `w_px` is `min(label, printhead)`: the repo contains both cases — `registry.json`
  uses the printhead width for a 50 mm label (584 px) and `docs/protocol-v4.md:370` uses
  the label width for a 30 mm cable flag (354 px) — and `min()` is the only rule both
  satisfy, unlike the doc's flat "always use the printhead width". The head width is a
  **parameter, never a constant**, because which value is right for the B1 Pro is
  unresolved (567 vs 584 — see `docs/NOTES.md`). `clamped` is returned so a caller can
  say it clamped: a silent clamp is how a label loses its right edge.
  Its harness anchors on the numbers the project arrived at independently — if the
  helper disagrees with `docs/protocol-v4.md:370`, the helper is wrong.
- **Demo: a Rolls panel, so registering a consumable is not a console job.** Read the
  tag (the barcode is never typed), enter the label's real size in mm and its colour,
  save. The computed pixels are shown live, and a width clamped to the printhead
  **says so, with how many mm will not print**. Custom sizes are stored beside
  `registry.json`, never merged into it — promoting a size into the shipped registry is
  a deliberate step, not a side effect of typing millimetres on a phone.
  **Copy JSON** puts both halves (sizes + rolls) on the clipboard — `localStorage` is
  per-browser and per-origin, so rolls registered on the phone are invisible on the
  desktop and die with the profile. If the clipboard refuses (Bluefy is third-party
  WebKit), it **says so and shows the JSON in a selectable box** rather than leaving you
  to paste stale clipboard content. Import fills gaps only, for the same reason `seed`
  does.
  Imported JSON is treated as **untrusted**, because the button exists so it can come
  from another device or another person while the page holds a Web Bluetooth connection
  to a printer: the roll list is built with DOM APIs and `textContent` rather than
  `innerHTML` (so a barcode, name or colour cannot inject markup at all), and every
  imported field is re-built against a strict shape — barcode and size id must match
  `/^[A-Za-z0-9._:-]{1,64}$/`, text must be printable and length-capped, numbers must be
  finite and bounded — rather than being stored as handed over.
  Never run against a printer: the panel is verified by inspection and syntax only.
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

[Unreleased]: https://github.com/iscarelli/niimbot-web-bluetooth/compare/v2.1.0...HEAD
[2.1.0]: https://github.com/iscarelli/niimbot-web-bluetooth/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/iscarelli/niimbot-web-bluetooth/compare/v1.4.0...v2.0.0
[1.4.0]: https://github.com/iscarelli/niimbot-web-bluetooth/compare/v1.3.5...v1.4.0
[1.3.5]: https://github.com/iscarelli/niimbot-web-bluetooth/compare/v1.3.4...v1.3.5
[1.3.4]: https://github.com/iscarelli/niimbot-web-bluetooth/compare/v1.3.3...v1.3.4
[1.3.3]: https://github.com/iscarelli/niimbot-web-bluetooth/compare/v1.3.2...v1.3.3
[1.3.2]: https://github.com/iscarelli/niimbot-web-bluetooth/compare/v1.3.1...v1.3.2
[1.3.1]: https://github.com/iscarelli/niimbot-web-bluetooth/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/iscarelli/niimbot-web-bluetooth/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/iscarelli/niimbot-web-bluetooth/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/iscarelli/niimbot-web-bluetooth/releases/tag/v1.1.0
