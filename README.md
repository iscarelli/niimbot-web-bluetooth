# niimbot-web-bluetooth

**Web Bluetooth** driver and protocol documentation for **Niimbot** label
printers — print straight from the browser, with no intermediary app.

Reverse-engineered and validated on real hardware (**Niimbot B1 Pro** and
**Niimbot B1**). Two print-task variants over the same frame cover the
**B1 Pro / B21 Pro / D11** line (300 dpi, `v4`) and the **B1 / B21** line
(203 dpi, protocol-3 `b1`) — selected per model via the `task` field in
`registry.json`.

## Contents

| Path | What it is |
|---|---|
| `src/niimbot.js` | Generic driver, no dependencies/build. Exposes `window.Niimbot`. |
| `registry.json` | Registry of printer models + label sizes. |
| `docs/protocol-v4.md` | Protocol V4 documentation (opcodes, frame, flow, geometry). |
| `demo/index.html` | Standalone demo: pair and print a test label. |

## Supported printers

| Model | `task` | dpi | Status |
|---|---|---|---|
| **Niimbot B1 Pro** | `v4` | 300 | ✅ Validated on real hardware |
| **Niimbot B1** | `b1` | 203 | ✅ Validated on real hardware |

Only these two are in `registry.json` and tested end-to-end. Other printers on the
same two protocol families — **`v4`**: D11_H / B21 Pro / D110_M; **`b1`**: B21 / D11 /
D110 / B21S — are likely compatible but **untested**. To try one, add a model entry to
`registry.json` (copy `b1pro` or `b1` and set its `task`/`dpi`); please report results.

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

> ⚠️ The B1 and B1 Pro both advertise as `B1…`, so the Bluetooth name **cannot**
> tell them apart — the *user* must pick the correct model (and matching dpi size).
> Picking the wrong one prints at the wrong resolution.

On the first `printImage`/`printBatch` the browser shows its Bluetooth chooser
(filtered by `name_prefixes`); the user selects the physical printer and pairs once.

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
- `Niimbot.isSupported()` → `false` on Firefox/Safari (no Web Bluetooth).
- `Niimbot.DEBUG = true` — log BLE packets + a per-batch timing trace to the console.
- `Niimbot.BUNDLE_MAX` — bytes per BLE write for frame bundling (default 240; `0`
  disables). Bundling cuts the paced-write count so dense pages stream without stalls.

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

## Credits

Protocol reverse-engineered and validated on the B1 Pro. External community
reference: [niim.blue](https://niim.blue) / niimbluelib.

## License

MIT — see [LICENSE](LICENSE).
