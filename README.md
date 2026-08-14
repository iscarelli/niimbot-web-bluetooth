# niimbot-web-bluetooth

[![Live demo](https://img.shields.io/badge/live-demo-2ea44f)](https://iscarelli.github.io/niimbot-web-bluetooth/demo/)
[![Release](https://img.shields.io/github/v/release/iscarelli/niimbot-web-bluetooth)](https://github.com/iscarelli/niimbot-web-bluetooth/releases)
[![npm](https://img.shields.io/npm/v/niimbot-web-bluetooth)](https://www.npmjs.com/package/niimbot-web-bluetooth)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
![Dependencies: none](https://img.shields.io/badge/dependencies-none-brightgreen)

**Web Bluetooth** driver and protocol documentation for **Niimbot** label
printers — print straight from the browser, with no intermediary app and no
dependencies.

Reverse-engineered and validated on real hardware (**Niimbot B1**, **B1 Pro**
and **M2-H**). Two print-task variants over the same frame cover the
**B1 Pro / B21 Pro / D11** line (300 dpi, `v4`) and the **B1 / M2-H / B21** line
(`b1`, mostly protocol 3) — chosen automatically per connected printer.

### 🖨 [Try the live demo →](https://iscarelli.github.io/niimbot-web-bluetooth/demo/)

Open it in **Chrome/Edge**, click *Connect & identify printer*, and print a test
label. (Web Bluetooth needs HTTPS — the live demo and `localhost` both qualify.)

<p align="center">
  <img src="https://raw.githubusercontent.com/iscarelli/niimbot-web-bluetooth/main/docs/demo.gif"
       alt="Pairing a Niimbot printer and printing a label from the browser demo" width="640">
</p>

<!-- TODO: record docs/demo.gif (~8–12 s, ≤640 px wide, a few MB): open the live demo,
     click "Connect & identify printer", pick the printer, print a label. Tools: ScreenToGif
     (Windows) or a screen recording → gif. Commit it at docs/demo.gif and this image renders
     on GitHub and npm. Until then the image above shows a broken-link icon. -->


## Contents

| Path | What it is |
|---|---|
| `src/niimbot.js` | Generic driver, no dependencies/build. Exposes `window.Niimbot`. |
| `registry.json` | Registry of printer models + label sizes. |
| `docs/protocol-v4.md` | Protocol V4 documentation (opcodes, frame, flow, geometry). |
| `demo/index.html` | Standalone demo: pair and print a test label. |

## Supported printers

| Model | `task` | dpi | Model id | Status |
|---|---|---|---|---|
| **Niimbot B1 Pro** | `v4` | 300 | 4097 | ✅ Validated on real hardware |
| **Niimbot B1** | `b1` | 203 | 4096 | ✅ Validated on real hardware |
| **Niimbot M2-H** | `b1` | 300 | 4608 | ✅ Validated on real hardware |

These three are in `registry.json` and tested end-to-end. Other printers on the same
two protocol families — **`v4`**: D11_H / B21 Pro / D110_M; **`b1`**: B21 / D11 / D110 /
B21S — are likely compatible but **untested**. To try one, add a model entry to
`registry.json` (copy an existing model, set its `task`/`dpi`/`id`); please report results.

> The driver auto-detects the connected model (see *Selecting your printer*), so it
> picks the right `task` and flow control even though several models share a BLE name.

## Selecting your printer

The app picks the printer by passing a **`model`** and **`size`** object (both from
`registry.json`) into the print calls:

- **`model`** chooses the protocol behaviour. The key field is **`task`**: `"v4"`
  (B1 Pro line, 300 dpi) or `"b1"` (B1 line, 203 dpi, protocol 3). It also carries
  `density` (1–5), `label_type`, `speed`, and **`name_prefixes`** — the list of BLE
  advertised-name prefixes used to filter the browser's device chooser.
- **`size`** is the label geometry in pixels: `w_px` (printhead axis) × `h_px` (feed
  axis), calibrated **per dpi**. A 50×30 mm label is a *different* pixel size on the B1
  (384×240 @ 203 dpi) than on the B1 Pro (584×354 @ 300 dpi) — always pair a size with
  a model of the **same dpi**.

  ⚠ **Same dpi is not enough — pair by MODEL.** The registry ships *three* 50×30 mm
  entries and two of them are 300 dpi:

  | id | model | `w_px` | why that width |
  |---|---|---|---|
  | `T50x30` | B1 Pro | 584 | the printable width used on that printer |
  | `T50x30_m2h` | **M2-H** | **567** | a deliberate ~1.4 mm right margin — see below |
  | `T50x30_b1` | B1 | 384 | 203 dpi |

  Filtering only by dpi offers both 300 dpi entries for either printer, and picking the
  wrong one is silent. **`w_px` is not "the printhead width"** — the driver sends it as
  `W` in `SetPageSize`, the printer prints columns `0 … W-1`, and anything past the head
  is dropped with no error. On the M2-H, 567 is not a head limit at all: that printer is
  **thermal transfer (it uses a ribbon)**, the ribbon drifts slightly, and the narrower
  width is a margin that absorbs the drift. Its head reaches at least 584 — solid black
  at 584 printed edge to edge (measured 2026-08-13). Use `T50x30` there and you lose the
  margin the number exists to provide; use it on a printer whose head really is narrower
  and you lose the right edge of every label.

  The safe pattern is the one the demo follows: call **`Niimbot.identify(model)`**, match
  `Niimbot.printer.modelId` against `id` in `registry.json`, and offer only the sizes
  belonging to that model.

**Auto-identification.** The B1 and B1 Pro advertise the same BLE name (`B1…`), but
the driver **does identify which is which**: on connect it asks the printer for its
model id (`PrinterInfo 0x40[08]`) and protocol version (`PrinterStatusData 0xA5`) —
exactly how niim.blue tells them apart — and exposes it as **`Niimbot.printer`**
(`{ modelId, protocolVersion, label, task, dpi }`). Validated ids: **B1 = 4096**,
**B1 Pro = 4097**. Two safeguards follow:

- **`Niimbot.identify(model)`** connects and returns that info *without* printing, so
  the app can auto-select the right model/size (the demo does this — match `model.id`
  in `registry.json` to `Niimbot.printer.modelId`).
- If you call `printImage`/`printBatch` with a model/size whose `task` or `dpi`
  doesn't match the connected printer, the driver **throws** before printing (naming
  the detected model) instead of printing at the wrong resolution.

On the first connect the browser shows its Bluetooth chooser (filtered by
`name_prefixes`); the user selects the physical printer and pairs once.

## Quick start

```html
<script src="src/niimbot.js"></script>
<script>
  // Pull these from registry.json — shown inline here for clarity.
  // B1 (203 dpi):   task "b1",  size 384×240
  // B1 Pro (300dpi): task "v4", size 584×354
  const model = { name_prefixes: ["B1"], task: "b1", density: 3, label_type: 1, speed: 1 };
  const size  = { w_px: 384, h_px: 240, offset_y_px: 4 };   // T50×30 on the B1

  if (Niimbot.isSupported()) {
    // One label:
    await Niimbot.printImage("/path/to/label.png", {
      model, size, onProgress: (s) => console.log(s),
    });

    // N identical labels — image uploaded ONCE, printer repeats it (fast):
    await Niimbot.printImage("/path/to/label.png", { model, size, copies: 5 });

    // N distinct labels — one continuous job, streamed back-to-back:
    await Niimbot.printBatch([url1, url2, url3], { model, size });
  }
</script>
```

The image must be exactly `w_px × h_px`. The driver thresholds it to 1-bit
(luminance < 128 = black) and sends it over BLE.

### API

- `Niimbot.printImage(url, { model, size, copies, offsetY, onProgress })` — print one
  image. **`copies`** (default 1) prints N identical labels from a **single** upload
  (the printer repeats the image internally) — far faster than re-sending it.
  **`offsetY`** overrides `size.offset_y_px` to nudge the print down (px, feed axis).
- `Niimbot.printBatch([url1, url2, …], { model, size, onProgress })` — N *distinct*
  labels in one continuous job (one upload each, streamed back-to-back, no retract).
- **Both reject when the printer did not confirm the job** — a page left unacknowledged,
  or the printed-page counter never reaching the total within `Niimbot.PAGE_WAIT_MS`
  (default 25 000). The error names what stalled and where. Through 1.4.0 they resolved
  either way, which is how a run that printed 4 of 5 labels reported success.
  **A rejection means "check the paper", not "nothing printed"**: PrintEnd is sent before
  the throw, so the paper is fed out and retracted, and some labels may have come out.
- `Niimbot.identify(model)` → connect and return `Niimbot.printer` without printing.
- `Niimbot.printer` → detected `{ modelId, protocolVersion, label, task, dpi }` (or
  `null` before connecting). Used to tell a B1 from a B1 Pro (same BLE name).
- `Niimbot.getStatus()` → consumable status of an **already connected** printer (it
  throws rather than connecting): `{ raw, decoded, confidence }`.
  **`raw`** is the contract — `{ heartbeat, heartbeatCmd, rfid }`, the exact response
  bytes (`Uint8Array`, or `null` if the printer stayed silent).
  **`decoded`** is `{ heartbeat, rfid, evidence }`. `heartbeat` carries `lidClosed` /
  `paperInserted` / `paperRfidSuccess` / `chargeLevel` / `temp`; `rfid` carries `uuid` /
  `barCode` / `serialNumber` / `usedPaper` / `capacity` / `printLimit` /
  `consumablesType`. **Either part — or `decoded` itself — can be `null`**: an
  unrecognised payload is reported as `confidence: "unknown"` instead of being
  half-decoded, and a printer that never answers `RfidInfo` (normal on many
  models/consumables) simply yields `rfid: null`.
  **Trust is per field — read `decoded.evidence`**, which mirrors the `heartbeat`/`rfid`
  keys and marks each one `"observed"` (moved on real hardware here, exactly as named),
  `"varies"` (moved, but what it measures is unsettled) or `"inferred"` (not confirmed
  here). Top-level `confidence` is a coarse floor over that map — `"validated"` when
  anything is observed, else `"inferred"`, or `"unknown"` when nothing decoded.
  ⚠ **Validated on the B1 Pro only, and only in part.** `lidClosed`, `paperInserted`,
  `paperRfidSuccess`, `usedPaper` and `capacity` are confirmed against real captures on a
  **B1 Pro (model id 4097)**; on any other model — including the B1 and M2-H, which have
  never been captured — every field drops to `"inferred"`, because lid polarity is known
  to be inverted on some printers. `chargeLevel`, `consumablesType` and the tag strings
  are unconfirmed everywhere, `temp` is `"varies"`, and `printLimit` (niimbluelib's
  `allPaper`) is a sourced inference, **not** a count of remaining paper.
  **The driver still never acts on any of it** — nothing blocks, delays or alters a print
  based on this. Evidence, capture tables and the fields 1.4.0 got wrong:
  [`docs/protocol-v4.md`](docs/protocol-v4.md#consumable-status).
- `Niimbot.readiness(status)` → a pure reporter over a `getStatus()` result:
  `{ ready, reasons, evidence }`. `ready` is `true`, `false` (with `reasons` such as
  `"lid open"`), or **`null` when it cannot tell** — "cannot tell" and "not ready" are
  deliberately different answers. `evidence` is the weakest marker it relied on, so you
  can decide how much to trust it. It is **not wired into any print path**: gating a
  print is the app's decision, not the driver's.
- `Niimbot.isSupported()` → whether `navigator.bluetooth` exists. `false` on Firefox
  and on Safari; `true` inside an iOS browser that polyfills it (see *Requirements*).
- `Niimbot.DEBUG = true` — log BLE packets + a per-batch timing trace to the console.
- `Niimbot.BUNDLE_MAX` — bytes per BLE write for frame bundling (default 240; `0`
  disables). Bundling cuts the paced-write count so dense pages stream without stalls.
- `Niimbot.PACE_MS` — gap (ms) between unacked writes (default 10). **macOS** drops
  unacked write bursts, so there the driver paces every model; lower this only if your
  printer tolerates a smaller gap.
- `Niimbot.WRITE_MODE` — override the write path the driver detected: `null` (default,
  auto) · `"fast"` (unacked, no gap) · `"paced"` (unacked + `PACE_MS`) · `"acked"`
  (write-with-response). Any other value **throws** rather than being ignored. It is read
  **per write**, so you can flip it on an open connection, and it never overwrites what
  was detected — `Niimbot.DETECTED_WRITE_MODE` and `Niimbot.EFFECTIVE_WRITE_MODE` report
  both, and the connect log line prints `writeMode=… override=… effective=…` **without
  needing `DEBUG`**.
  It goes both ways on purpose: forcing `"paced"` is the escape hatch for a platform that
  drops unacked bursts (a blank or short label while progress reports 100%), and forcing
  `"fast"` is how you find out whether a platform needed the pacing at all — see *iOS
  coverage*. Forcing `"fast"` on a model that `MODEL_IDS` marks `paced` (the 203 dpi B1)
  logs a warning and is still obeyed: that combination is a diagnostic, not a setting.
- `Niimbot.FORCE_PACING` — **deprecated alias** for `WRITE_MODE`, kept because it is
  published API since 1.4.0 and still works. Reading it is `WRITE_MODE === "paced"`;
  `= true` sets `"paced"`; `= false` clears the override to `null` — including a `"fast"`
  or `"acked"` one, since a boolean cannot express "not paced, but keep that". Prefer
  `WRITE_MODE`.

## Requirements

Any browser with **Web Bluetooth**, over **HTTPS** or `localhost`. Firefox has no
Web Bluetooth on any platform.

| Platform | What works |
|---|---|
| **Desktop** (Windows, macOS, Linux, ChromeOS) | Chrome / Edge / Opera — native. |
| **Android** | Chrome, Edge, Opera, Samsung Internet — native. Bluetooth **and location** must be on, or the device chooser opens empty (Android ties BLE scanning to location). Open the page in Chrome itself: an in-app WebView (opening the link from inside a chat app) may not expose Web Bluetooth. |
| **iOS / iPadOS** | Safari has none and [Apple has no plan to add it](https://github.com/WebBluetoothCG/web-bluetooth/blob/main/implementation-status.md) — and every iOS browser is WebKit, so Chrome/Edge for iPhone don't have it either. Use a browser that polyfills `navigator.bluetooth` over CoreBluetooth: **[Bluefy](https://apps.apple.com/us/app/bluefy-web-ble-browser/id1492822055)** (free) or WebBLE. |

### iOS coverage — what has actually been tried

Printing from an iPhone works. Here is the exact extent of the testing behind that,
rather than a blanket claim:

- **Validated on the B1 Pro via Bluefy (2026-08-11):** a single label, the
  5-dense-label stress run, and a 3-label batch. All printed correctly, with a short
  pause between labels (see the next point for what that pause probably is). The
  polyfill covers everything the driver needs: `namePrefix` filters, GATT,
  notifications and `writeValueWithoutResponse`.
- **iOS needs the pacing — measured on paper, 2026-08-13.** `IS_MAC`
  (`src/niimbot.js:107`) falls back to matching `/Mac/i` against the user agent, and
  **every iOS user agent contains `"like Mac OS X"`** — so `IS_MAC` is **`true` on an
  iPhone** (the connect line on the iPhone reads `mac=true`). That was an accident of
  implementation rather than a decision, so the unpaced path had never run on iOS and
  the pacing had never been justified there. It is now, by measurement:

  | Run (iPhone + Bluefy + B1 Pro, *Print 5 dense labels*, same roll) | On the paper |
  |---|---|
  | `WRITE_MODE = "fast"` | **4 labels, every one numbered `1`, noise band truncated** — and it reported success |
  | `WRITE_MODE = "paced"` (control) | **5 labels, `1`–`5`, noise band full-height to the label edge** |

  Only the write mode differed — same batch, same images, same roll — so the loss is
  the unacked burst, not the batch code. **iOS drops unacked writes the way macOS
  does**, and the current default is right. Note the failure signature: **it is not a
  clean blank page.** Rows went missing *and* the page numbering did not advance —
  four labels all read `1`. Why the number repeated is not established (the packet log
  shows the printer's page counter stalling at 4 of 5, not what raster it reused), and
  it does not need to be, because the write mode is what changed. What matters for
  anyone diagnosing this: a corrupt run can look like a plausible print until you read
  the numbers on the paper.
- **Still open on iOS: is `PACE_MS = 10` the right amount?** Only `fast` (broken) and
  the default pacing (correct) have been tried; nothing brackets the boundary between
  them. The short pause between labels on the iPhone is `PACE_MS`, not BLE throughput.
- **Not tried: B1 and M2-H on iOS.** These are the models that bundle frames
  (`BUNDLE_MAX = 240`, `src/niimbot.js:144`), and CoreBluetooth commonly caps an
  unacked write near 182 bytes — an oversized write can be truncated silently.
  If a page comes out incomplete on those, try `Niimbot.BUNDLE_MAX = 180`.

## Demo

Serve the repo over localhost and open the demo (Web Bluetooth needs HTTPS or
`localhost`). A dependency-free Node server is included:

```bash
node demo/serve.mjs          # then open http://localhost:8080/demo/index.html
```

The demo has a **Model** dropdown (B1 / B1 Pro) and a **Label** dropdown that only
offers sizes matching the selected model's dpi — mirroring the selection rules above.
Buttons cover a single label, 3 identical copies (one upload), a 3-label batch
(distinct), and dense stress tests. **Read status** calls `Niimbot.getStatus()` on an
already-connected printer and hex-dumps the raw heartbeat/RFID bytes into the log
panel — capturing those next to what the printer physically shows (lid, paper, tag) is
exactly how the confirmed fields got confirmed, and how the rest still can be.

A **Rolls** panel (collapsed by default) registers a consumable without a console: press
*Read tag* with the roll fitted, type the label's real size in mm and its colour, and
save. The computed pixels appear live, and a width clamped to the printhead says so and
how many mm will not print. Custom sizes are kept **beside** `registry.json`, never
merged into it. *Copy JSON* puts sizes and rolls on the clipboard — `localStorage` is per
browser and per origin, so what you register on the phone is invisible on the desktop —
and if the clipboard refuses, it says so and shows the JSON to copy by hand.

It also has an **on-screen log panel** mirroring everything the driver writes to the
console, with a *Copy log* button, a **Write mode** selector (auto / fast / paced /
acked → `Niimbot.WRITE_MODE`) and a `Niimbot.DEBUG` checkbox. That panel exists for
phones: a browser on Android or iOS gives you no console, so
`writeMode=… override=… effective=…` — the line that tells you which path a print
actually took — would otherwise be unreadable on the exact platforms whose behaviour is
least known. The selector is a native `<select>` with a 44 px tap target on purpose:
the iOS measurement above is run one-handed, on the phone.

### Remembering the label size per roll — an app pattern, not a driver feature

The RFID tag identifies the roll (`barCode`) but **does not carry its dimensions** —
the official app looks those up on Niimbot's server. Picking the wrong size silently
ruins labels, so the demo learns instead of guessing: on connect it reads the tag, and
if it has seen that barcode before it pre-selects the size **the user actually printed
with last time** (and says so in the log panel — a silent auto-selection is worse than
none, because you stop checking). On a miss it changes nothing.

**The driver does not do this for you, on purpose.** `src/niimbot.js` reads no config
and owns no UI: it takes the model and size from the caller, so it can't know which of
*your* sizes a barcode means, and putting `localStorage` in it would break that
contract. It gives you the one thing you can't get elsewhere — the barcode.

The storage is a **separate, optional file**. Loading it is the opt-in; it never
references `Niimbot`, so load order does not matter and you can use either alone:

```html
<script src="niimbot.js"></script>
<script src="label-memory.js"></script>   <!-- optional -->
<script src="label-size.js"></script>     <!-- optional -->
```

```js
// `key` is required and has NO default: two apps on one origin share one localStorage,
// so a default key would silently merge their memories.
const mem = NiimbotLabelMemory.create({ key: "my-app:size-by-barcode" });

// After identify/connect: restore what this roll printed with last time.
const st = await Niimbot.getStatus();               // never let this break connecting
const rfid = st && st.decoded && st.decoded.rfid;   // may be null: no tag, or a model
                                                    // that never answers RfidInfo
const rec = rfid && rfid.tagPresent && mem.recall(rfid.barCode);   // → { size, color, … }
if (rec) selectSize(rec.size);

// After a print SUCCEEDS: learn from what the user did. Merge, so a colour or name
// entered elsewhere is not wiped by printing.
mem.remember(rfid.barCode, { ...mem.recall(rfid.barCode), size: selectedSizeId });

// Bulk-load rolls you already know. Fills gaps ONLY: hand-typed must not overwrite what
// a real print taught. `{ overwrite: true }` is there for the deliberate reset.
mem.seed({ "6975746632324": { size: "T30x45", color: "white" } });
```

`recall()` returns a **record**, not a size id — the tag carries no colour, so colour
lives here alongside the size, and any extra key your app writes survives untouched. A
value stored as a bare string by an older version reads back as `{ size }`; nothing is
rewritten in bulk.

`NiimbotLabelSize.sizeFromMm({ w_mm, h_mm, dpi, printhead_px })` turns a measurement into
the `w_px`/`h_px`/`stride` a size entry needs, clamping the width to the printhead and
telling you when it did — see § *Label geometry* in `docs/protocol-v4.md` for why that
clamp is `min()` and not a flat rule.

Two properties worth keeping if you write your own instead: every `localStorage` access
is wrapped (it throws in Safari private mode and when cookies are blocked) so a storage
failure costs the memory and never the print, and a `getStatus()` failure means "no
memory this time", never a failed connect or a failed print. The tag's
`consumablesType` is the same enum as `label_type` (1 = with gaps, 2 = black,
3 = continuous, 4 = perforated, 5 = transparent, 6 = PVC tag, 10 = black mark gap,
11 = heat-shrink tube), so a mismatch with the selected model is worth **warning**
about — but not overriding: the field is marked `inferred` (only ever observed as `1`).

Exercised against a real tag on a B1 Pro, 2026-08-13: the roll's barcode was learned
from a print, restored on a later *Connect & identify* (the dropdown moved and the log
panel said so), and reported without moving the dropdown on *Read status*. Two branches
were **not** reached and stay unverified — a remembered size that the selected model
does not offer, and the `consumablesType` mismatch warning, which needs a consumable
whose type is not `1` and may not be reachable with stock rolls. Both can be driven from
the console with a hand-made status object; the demo exposes `reviewTag` for that.

## Real-world use

Used in **[spool-control](https://github.com/iscarelli/spool-control)** — a web app for
managing 3D-printing filament spools — to print spool labels straight from the browser,
no app:

<p align="center">
  <img src="https://raw.githubusercontent.com/iscarelli/niimbot-web-bluetooth/main/docs/real.gif"
       alt="The niimbot-web-bluetooth driver printing filament-spool labels inside the spool-control web app" width="560">
</p>

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| **macOS: print comes out blank but progress hits 100%** | macOS CoreBluetooth drops unacked write bursts. The driver already paces writes on macOS; if it still happens, raise the gap: `Niimbot.PACE_MS = 16` (or higher). |
| **Error `"Connected printer is X … select Y"`** | The selected model doesn't match the connected printer. Pick the model the driver detected (`Niimbot.printer`), or use *Connect & identify* in the demo. |
| **Dense / image-heavy labels are slow or stall between labels** | This is BLE throughput on worst-case content. Tune `Niimbot.BUNDLE_MAX` (frames per write) and `Niimbot.PACE_MS` (gap). Real labels (text/codes, mostly white) stream fine; for N identical labels use `copies` (one upload). |
| **Printer never starts / `PageEnd` never acks (B1, 203 dpi)** | An unacked burst dropped rows. Keep `Niimbot.PACE_MS` ≥ 10 for the B1. |
| **`Niimbot.isSupported()` is false** | Firefox (no Web Bluetooth anywhere), Safari (see the iPhone row), an in-app WebView, or you're not on HTTPS/localhost. |
| **iPhone: the connect button does nothing / not supported** | Safari has no Web Bluetooth. Open the page in **Bluefy** instead — validated on the B1 Pro (see *Requirements*). |
| **Android: the device chooser opens with no printers** | Location services must be on, not just Bluetooth — Android gates BLE scanning behind location. It is not a pairing problem. |
| **Nothing prints, no error** | Open the console and set `Niimbot.DEBUG = true` to see the BLE packets + per-batch timing trace, then check where it stalls. |

## Credits

Protocol reverse-engineered and validated on the B1 Pro. External community
reference: [niim.blue](https://niim.blue) / niimbluelib.

## License

MIT — see [LICENSE](LICENSE).
