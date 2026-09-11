# Fixture: the real ESP32-Telemetria-Suite label batch (the one that fails)

The 10 pages of the print job that does **not** come out of a D11_H, exactly as the
consumer hands them to `printBatch` — printer-ready canvases, 142 × 260 px, already
rotated. Dropped here so this batch can be reproduced without the panel, the database or
the browser that draws it.

Put here on 2026-09-10 by the ESP32-Telemetria-Suite session. **Nothing was committed —
`git add` and the commit are yours to make or skip.**

## What these are

The panel prints one label per circuit breaker in a switchboard column, plus a first
**reference label** that carries the board's name and is thrown away after it identifies
the roll. Real data, from the real board: `NewDevice_003`, device id `MC-6408`, column 1,
9 breakers + 1 reference = the 10 pages of the failing job.

| file | content | frames |
|---|---|---|
| `page-00-referencia.png` | board name, device id, `coluna 1 · 9 etiqueta(s)` | 208 |
| `page-01-1_geral.png` | `1.geral` / `MCP0.A.7` | 161 |
| `page-02-1_1.png` … `page-09-1_8.png` | `1.N` / `MCP1.x.y` | 99–122 |

`paginas.json` has the same table, machine-readable. Total: **1272 frames**.

## The frame counts, and why they matter

Counted with the `frames()` you sent us, run over the rotated canvas — the same bytes
`printBatch` receives.

🔥 **These are 2 to 3 times heavier than the `~79 frames` assumed on your bench.** The
D11_H's own debug log agrees with the numbers here, not with 79:

```
page 0 → (… 213 image rows 0x84/0x85 …)      fixture says 208
page 1 → (… 161 image rows 0x84/0x85 …)      fixture says 161   ← exact
page 2 → (… 103 image rows 0x84/0x85 …)      fixture says 111
page 3 → (… 116 image rows 0x84/0x85 …)      fixture says 120
```

The small gaps are the empty `0x84` rows the log counts and `frames()` does not. Page 1
matching exactly is the evidence that the method is the same one.

Any bench conclusion drawn from four ~21-frame labels should be re-run against these.

## What happened with these exact pages (2.6.0, real D11_H, 2026-09-10)

- **Sequential** (`PAGE_PIPELINE = false`, `PAGE_ACK_MS = 10000`): **zero labels**. Nothing
  came out. Raising the ack deadline on its own did not fix this batch.
- **Pipeline** (`PAGE_PIPELINE = true`): **one label, cut short**, then it stopped.

From the pipeline log, four facts that don't fit the "the ack is just slow" story:

1. **Page 1 acked in 1109 ms** — comfortably inside the old 3000 ms. On this run the
   deadline was not the bottleneck.
2. **`← db (1b) 06` appeared three times**, always as the reply to the `(0xa3, 0x13)` pair
   that opens the *next* page — never to `0xe3`. That is your own written stop criterion
   for the pipeline.
3. **No `0xe4` ever came back after page 1.** Labels 2, 3 and 4 logged
   `PageEnd UNACKED after ~10000 ms`.
4. **The printer's counter disagrees with the paper.** `b3` parked at
   `00 01 64 64 15 16 00 02` — page 2, print 100 %, feed 100 % — and stayed there through
   dozens of polls. On paper there is **one** label, and it is incomplete.

Read together, they suggest the printer enters a state where it stops emitting `0xe4` and
answers `db 06`, while its own counter claims 100 % for a page that never finished. A
longer deadline only makes the driver wait longer for something that is not coming.

**This is a reading, not a measurement. Contradict it if the fixture says otherwise —
you have the protocol and the hardware, we have the symptom.**

## The measurement still missing

**One page, alone, through `printImage`, timed, with `DEBUG` on.** Use
`page-00-referencia.png` — the heaviest, 208 frames. It splits the question in two and
neither branch is ambiguous:

- comes out whole → the problem is in the batch/sequence, not the page;
- comes out cut → the problem is the page itself, and the suspicion moves to geometry
  (`T12x22` was validated with single prints, on your roll, not this one).

## How these were generated

The consumer's drawing code, not a copy of it: `qdc-etiquetas.js` is an IIFE, so the
harness strips the wrapper, evaluates the body in global scope (its `var`s become
globals), sets the real data, and calls `desenhaReferencia()` / `desenhaComposicao()` and
then `paraImpressora()` — the same path the browser takes to build a print job. Source:
`ESP32-Telemetria-Suite/server/static/js/qdc-etiquetas.js` at commit `b55d7ba`.
