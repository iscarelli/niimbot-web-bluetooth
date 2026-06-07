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

## Quick start

```html
<script src="src/niimbot.js"></script>
<script>
  // task: "v4" = B1 Pro/B21 Pro/D11 (300dpi); "b1" = B1/B21 (203dpi).
  const model = { name_prefixes: ["B1"], task: "v4", density: 3, label_type: 1, speed: 1 };
  const size  = { w_px: 584, h_px: 354 };       // T50×30 (50×30mm @ 300dpi)
  if (Niimbot.isSupported()) {
    await Niimbot.printImage("/path/to/label.png", {
      model, size, onProgress: (s) => console.log(s),
    });
  }
</script>
```

The image must be exactly `w_px × h_px`. The driver thresholds it to 1-bit
(luminance < 128 = black) and sends it over BLE. See `registry.json` for the
`model`/`size` values.

- `Niimbot.printImage(url, { model, size, onProgress })`
- `Niimbot.printBatch([url1, url2, …], { model, size, onProgress })`
- `Niimbot.isSupported()` → `false` on Firefox/Safari (no Web Bluetooth)

## Requirements

**Chrome/Edge** (Chromium) over **HTTPS** or `localhost`. Web Bluetooth does not
exist on Firefox/Safari.

## Demo

Serve the folder over HTTPS/localhost and open `demo/index.html`:

```bash
python -m http.server 8000   # then open http://localhost:8000/demo/
```

## Credits

Protocol reverse-engineered and validated on the B1 Pro. External community
reference: [niim.blue](https://niim.blue) / niimbluelib.

## License

MIT — see [LICENSE](LICENSE).
