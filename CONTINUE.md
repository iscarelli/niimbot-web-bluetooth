# Continuation notes — Niimbot B1 work

> Working copy of the session memory, kept in-repo so it travels across machines.
> Branch: **`feat/niimbot-b1`** (pushed, **not released** — no tag yet).

## Status (2026-06-07)

Added Niimbot **B1** (203 dpi, `protocolVersion 3`) support to the web-bluetooth
driver, alongside the already-validated **B1 Pro** (`v4`). Change is additive — the
B1 Pro path is untouched. **Printed end-to-end on real B1 hardware.**

What the B1 needs that the B1 Pro doesn't (full detail in `docs/protocol-v4.md`):
- **Post-connect handshake** (`PrinterStatusData 0xA5`, `PrinterInfo 0x40`×8,
  `Heartbeat 0xDC`) — without it the printer accepts every setup command but never
  starts printing (PageEnd never acks, status frozen at state `0x02`).
- **PrintStart 7b**, **PageStart 0x03**, **SetPageSize 6b** (rows, cols, copies).
- **Paced row writes (~12 ms)**: the characteristic is `WRITE_NO_RESPONSE` only, so
  an unacked burst drops rows → incomplete page / mid-label stall. (`PACE_MS` in
  `src/niimbot.js`.) 3 ms printed ~64 % then stalled; 12 ms prints fully.
- **`w_px` = printhead width (384)**, not label width (400) — else the rightmost
  ~16 px (a right-edge border) are clipped.
- Image rows use **total-mode** counts (same encoder as `v4`); **one job per label**.

## Next session — TODO (user's explicit follow-up)

B1 is slower than niim.blue to **start** printing and **between labels**. Optimize:

1. **Row pacing** — find the lowest reliable `PACE_MS` (between 3 and 12 ms), or a
   smarter flow-control than a fixed sleep.
2. **Per-label overhead** — each label re-runs PrintStart/PageStart/SetPageSize/rows/
   PageEnd + `0xA3` poll until `page≥1` + PrintEnd. niim.blue may pipeline; check
   whether the B1 can take multiple pages per job, and whether the end-of-label poll
   can be shortened.

## Dev aids in the code

- Driver logging is opt-in: set `Niimbot.DEBUG = true` in the console.
- `Niimbot.VERSION` string + the demo cache-busts the driver script (shows the
  version in the tab title / console) — handy to confirm fresh JS loaded.
- Local test server: `python3 -m http.server 8000` then open
  `http://localhost:8000/demo/` in Chrome/Edge.

## On the other machine

You'll need git push auth set up there (SSH key or token). Commit author for this
repo is **`Dimitri Carelli <iscarelli@gmail.com>`** (`git config user.email` is set
locally per-repo; global is a different address).
