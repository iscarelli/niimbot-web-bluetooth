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
- `Niimbot.identify(model)` → connect and return `Niimbot.printer` without printing.
- `Niimbot.printer` → detected `{ modelId, protocolVersion, label, task, dpi }` (or
  `null` before connecting). Used to tell a B1 from a B1 Pro (same BLE name).
- `Niimbot.isSupported()` → `false` on Firefox/Safari (no Web Bluetooth).
- `Niimbot.DEBUG = true` — log BLE packets + a per-batch timing trace to the console.
- `Niimbot.BUNDLE_MAX` — bytes per BLE write for frame bundling (default 240; `0`
  disables). Bundling cuts the paced-write count so dense pages stream without stalls.
- `Niimbot.PACE_MS` — gap (ms) between unacked writes (default 10). **macOS** drops
  unacked write bursts, so there the driver paces every model; lower this only if your
  printer tolerates a smaller gap.

## Requirements

**Chrome/Edge** (Chromium) over **HTTPS** or `localhost`. Web Bluetooth does not
exist on Firefox/Safari.

## Demo

Serve the repo over localhost and open the demo (Web Bluetooth needs HTTPS or
`localhost`). A dependency-free Node server is included:

```bash
node demo/serve.mjs          # then open http://localhost:8080/demo/
```

The demo has a **Model** dropdown (B1 / B1 Pro) and a **Label** dropdown that only
offers sizes matching the selected model's dpi — mirroring the selection rules above.
Buttons cover a single label, 3 identical copies (one upload), a 3-label batch
(distinct), and dense stress tests.

## Real-world use

The driver running inside a real application, printing actual labels over Web
Bluetooth — not just the test pattern:

<p align="center">
  <img src="https://raw.githubusercontent.com/iscarelli/niimbot-web-bluetooth/main/docs/real.gif"
       alt="The driver printing real labels from a production web app" width="560">
</p>

<!-- Tip: edit this caption to name the app / use case for stronger social proof. -->

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| **macOS: print comes out blank but progress hits 100%** | macOS CoreBluetooth drops unacked write bursts. The driver already paces writes on macOS; if it still happens, raise the gap: `Niimbot.PACE_MS = 16` (or higher). |
| **Error `"Connected printer is X … select Y"`** | The selected model doesn't match the connected printer. Pick the model the driver detected (`Niimbot.printer`), or use *Connect & identify* in the demo. |
| **Dense / image-heavy labels are slow or stall between labels** | This is BLE throughput on worst-case content. Tune `Niimbot.BUNDLE_MAX` (frames per write) and `Niimbot.PACE_MS` (gap). Real labels (text/codes, mostly white) stream fine; for N identical labels use `copies` (one upload). |
| **Printer never starts / `PageEnd` never acks (B1, 203 dpi)** | An unacked burst dropped rows. Keep `Niimbot.PACE_MS` ≥ 10 for the B1. |
| **`Niimbot.isSupported()` is false** | You're on Firefox/Safari, or not on HTTPS/localhost. Use Chrome/Edge over HTTPS. |
| **Nothing prints, no error** | Open the console and set `Niimbot.DEBUG = true` to see the BLE packets + per-batch timing trace, then check where it stalls. |

## Credits

Protocol reverse-engineered and validated on the B1 Pro. External community
reference: [niim.blue](https://niim.blue) / niimbluelib.

## License

MIT — see [LICENSE](LICENSE).
