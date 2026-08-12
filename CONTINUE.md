# Continuation notes — Niimbot B1 work

> Working copy of the session memory, kept in-repo so it travels across machines.
> Merged to **main**; latest release **v1.4.0** (mobile: iPhone via Bluefy validated on the
> B1 Pro, Android natively; `FORCE_PACING`; demo log panel; `getStatus()` with an
> **unvalidated** decode — see `CHANGELOG.md`).
> **M2-H validated** (id 4608, 300 dpi, b1 task + fast writes). The only residual
> slowness is a full random-noise page at 300 dpi (BLE throughput, MTU ≈ 247 → ~2
> frames/write) — not a real-label case. v4 sequence was tested on M2-H, no better.
> Still pending (Vikunja #56): D110, D11_H.

## Status (2026-06-07) — B1 complete, validated on real hardware

Niimbot **B1** (203 dpi, `protocolVersion 3`) support added to the web-bluetooth
driver, alongside the already-validated **B1 Pro** (`v4`). Additive — the B1 Pro path
is untouched. All cases print **continuously** on real B1 hardware: single label,
N copies, and N distinct labels. Speed matches niim.blue (and beats it on worst-case
content, thanks to frame bundling).

**Model auto-identification** (B1 and B1 Pro share the BLE name): `connect()` reads
the model id (`0x40[08]`→`0x48`, BE u16: B1=4096, B1 Pro=4097) and protocol version
(`0xA5`→`0xB5`), exposes `Niimbot.printer`, and `assertSelection()` refuses to print
on a task/dpi mismatch. `Niimbot.identify(model)` returns it without printing;
`Niimbot.disconnect()` drops the link to pair another. writeMode + handshake follow
the **detected** model, so an identify-then-print (or wrong pick) still arms a real B1.

## Next (tracked in Vikunja)
- **Compatibilizar D110, D11_H e M2_H** — add these models (D110 = its own niimbluelib
  print task; D11_H = `v4`/D110M_V4; M2_H = `b1`). Needs ids + task wiring + testing.
- **Implementar status de material** — surface paper/label and RFID/consumable status
  (heartbeat `0xDC`→`0xD9` carries lid/paper flags; `RfidInfo 0x1A`→`0x1B`).

What the B1 needs that the B1 Pro doesn't (full detail in `docs/protocol-v4.md`):
- **Post-connect handshake** (`PrinterStatusData 0xA5`, `PrinterInfo 0x40`×8,
  `Heartbeat 0xDC`) — without it the printer accepts every setup command but never
  starts printing (PageEnd never acks, status frozen at state `0x02`).
- **PrintStart 7b**, **PageStart 0x03**, **SetPageSize 6b** (rows, cols, copies).
- **Paced row writes (~10 ms)**: the characteristic is `WRITE_NO_RESPONSE` only, so
  an unacked burst drops rows. 10 ms is niim.blue's value (`PACE_MS` in `niimbot.js`).
- **`w_px` = printhead width (384)**, not label width (400) — else the rightmost
  ~16 px (a right-edge border) are clipped. (niim.blue uses 400; 384 keeps a margin.)
- Image rows use **total-mode** counts (same encoder as `v4`).

## Resolved — the slowness work (was the open TODO)

The earlier "slow to start / stops between labels" was diagnosed with an in-driver
timing trace and a captured niim.blue BLE log, then fixed:

1. **Single job, N pages** (not one job per label) — `printStart7b` declares N, each
   `PageEnd` parks the paper, lone `PrintEnd` feeds out. No retract between labels.
2. **`copies`** (`printImage(url, { copies:N })`) — identical labels upload the image
   ONCE (`SetPageSize` copies=N); the printer repeats it. This is exactly what
   niim.blue does for a multi-copy job.
3. **Frame bundling** — several row frames per BLE write (`Niimbot.BUNDLE_MAX`, def
   240 B), cutting the paced-write count ~4×. Root cause of the residual gap was that
   each row was its own ~10 ms-paced write, so a dense page sent slower than it
   printed (starvation). Bundling is something niim.blue does NOT do.

Verified: 3 copies → direct; 3 distinct realistic labels → direct; 3 dense (random
noise, worst case) → only a minimal pause. Driver considered viable.

## Dev aids in the code

- Driver logging is opt-in: set `Niimbot.DEBUG = true` in the console — this also
  enables the `[niimbot t+…ms]` batch timing trace.
- `Niimbot.BUNDLE_MAX` (bytes/BLE write, default 240) is tunable at runtime; `0`
  disables bundling (one frame per write). Raise toward 480 if the MTU allows.
- `Niimbot.VERSION` string + the demo cache-busts the driver script (shows the
  version in the tab title / console) — handy to confirm fresh JS loaded.
- Local test server: `node demo/serve.mjs` then open
  `http://localhost:8080/demo/index.html` in Chrome/Edge (the bare `/demo/` 404s —
  the server has no directory index). (On this machine `python` is only the
  Microsoft Store stub — use node.)

## On the other machine

You'll need git push auth set up there (SSH key or token). Commit author for this
repo is **`Dimitri Carelli <iscarelli@gmail.com>`** (`git config user.email` is set
locally per-repo; global is a different address).
