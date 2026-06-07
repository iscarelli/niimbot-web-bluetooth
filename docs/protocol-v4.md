# Niimbot Protocol V4 (D11 / B1 / B1 Pro / B21 line)

Reverse-engineered and validated in the lab on the **Niimbot B1 Pro** and the
**Niimbot B1**. Covers two print-task variants over the same frame: `v4`
(D110_M / D11_H / B1 Pro / B21 Pro, 300 dpi) and `b1` (B1 / B21 / D11, **protocol
version 3**, 203 dpi). See [Print task variants](#print-task-variants-v4-vs-b1).

> **Validated:** the **B1** (`b1`), **B1 Pro** (`v4`) and **M2-H** (`b1`, 300 dpi) are
> tested on real hardware. The other models listed per family share the protocol and
> should work, but are **untested** — treat their parameters as a starting point.

## Transport (Web Bluetooth / BLE GATT)

| Item | Value |
|---|---|
| Service UUID | `e7810a71-73ae-499d-8c15-faa9aef0c3f2` |
| Characteristic UUID | `bef8d6c9-9c21-4c9e-b632-bd58c1009f9f` |
| Properties | `NOTIFY` + `WRITE_NO_RESPONSE` |
| Initial connection packet (raw) | `03 55 55 C1 01 01 C1 AA AA` |

Device filtering: the advertised name starts with `B1` / `B2` / `D1`.

**Browser constraints:** Web Bluetooth requires **HTTPS** (or `localhost`) and a
user gesture (a click). It works on **Chrome/Edge** (Chromium in general); it
**does not exist** on Firefox/Safari.

## Packet frame

```
[0x55, 0x55, cmd, len, ...data, crc, 0xAA, 0xAA]
crc = cmd XOR len XOR (all data bytes)
```

Responses arrive via NOTIFY in the same frame (`0x55 0x55 cmd len ... crc 0xAA 0xAA`).

## Opcodes

| Cmd | Name | Response | Notes |
|---|---|---|---|
| `0xC1` | Connect | `0xC2` | sent raw with a `03` prefix: `03 55 55 C1 01 01 C1 AA AA`. Resp data = `[connectResult]` |
| `0xA5` | PrinterStatusData | `0xB5` | data = `[1]`. **`b1` handshake** (see below) |
| `0x40` | PrinterInfo | `0x48`,`0x4B`,`0x4D`,`0x4A`,`0x47`,`0x43`,`0x4C`,`0x49` | data = `[sub]`. **`b1` handshake** — one query per sub-code |
| `0xDC` | Heartbeat | `0xD9` | data = `[04]`. **`b1` handshake** |
| `0x21` | SetDensity | `0x31` | data = `[density]` (B1: 1–5; 3 = default) |
| `0x23` | SetLabelType | `0x33` | data = `[1]` (with gaps) |
| `0x01` | PrintStart | `0x02` | data = `[pages_hi pages_lo 00 00 00 00 00 speed 00]` (9b, `v4`) **or** `[pages_hi pages_lo 00 00 00 00 00]` (7b, `b1`) |
| `0x03` | PageStart | `0x04` | data = `[1]`. **`b1` task only** — opens each page before SetPageSize |
| `0xA3` | PrintStatus | `0xB3` | data = `[1]`. Response: `page(u16 BE), print%, feed%, state…`. `b1`: `page` reaches 1 at 100 % |
| `0x13` | SetPageSize | `0x14` | data = `[H_hi H_lo W_hi W_lo 00 01 00×7]` (13b, `v4`) **or** `[H_hi H_lo W_hi W_lo 00 01]` (6b, `b1` — rows, cols, copies) |
| `0x84` | PrintEmptyRow | — | data = `[row_hi, row_lo, run]` (blank row) |
| `0x85` | PrintBitmapRow | — | data = `[row_hi, row_lo, 00, total_lo, total_hi, run, ...stride]` (total mode, both tasks) |
| `0xE3` | PrintEnd (page) | `0xE4` | data = `[1]` |
| `0xF3` | PrintEnd | `0xF4` | data = `[1]` |

`H` = height (feed axis, number of rows), `W` = width (printhead axis).
`total` = number of black bits in the row. `run` = how many identical
consecutive rows (run-length, max 200). `stride = ceil(W / 8)` bytes per row,
**MSB-first** (bit 0x80 = leftmost pixel; 1 = black).

## Print flow (one label)

```
connect()                              # GATT + 0x03… connection packet
SetDensity(0x21,[density])      -> 0x31
SetLabelType(0x23,[1])          -> 0x33
PrintStart(0x01,[…,speed,…])    -> 0x02
PrintStatus(0xA3,[1])  (one-way, no wait)  + ~30 ms   # B21 Pro workaround
SetPageSize(0x13,[H,W,…])       -> 0x14
for each row:
    empty  -> PrintEmptyRow(0x84,[row, run])
    pixels -> PrintBitmapRow(0x85,[row, 0, total, run, ...bitmap])
PrintEnd-page(0xE3,[1])         -> 0xE4
loop: PrintStatus(0xA3,[1]) -> 0xB3 until page >= 1   (timeout ~25 s)  # CRITICAL
PrintEnd(0xF3,[1])              -> 0xF4
```

> **Why the poll is critical:** without waiting for `page >= 1`, `PrintEnd`
> arrives mid-print and the label comes out **cut off**.

## Print task variants (`v4` vs `b1`)

The same frame carries two print-task sequences, selected per model via the
`task` field in `registry.json`. The bitmap rows (`0x84`/`0x85`, total mode),
status poll and `PrintEnd` are identical; setup and delivery differ.

| Step | `v4` (D11 / B1 Pro / B21 Pro, 300 dpi) | `b1` (B1 / B21, protocol 3, 203 dpi) |
|---|---|---|
| Post-connect handshake | none | **required** — see below |
| PrintStart `0x01` | 9 bytes, includes `speed` | **7 bytes**, no `speed`; `pages`=N |
| Page open | `PrintStatus 0xA3` one-way (+~30 ms) | **`PageStart 0x03 [1]` → `0x04`** |
| SetPageSize `0x13` | 13 bytes | **6 bytes** (`H,W,copies`) |
| Row write | unacked burst | **paced** unacked (~10 ms/write), frames bundled |
| Job span | one job, N pages pipelined | one job, N pages pipelined |

`b1` flow: handshake → `SetDensity` → `SetLabelType` →
`PrintStart(0x01,[pages,0,0,0,0,0]) -> 0x02` →
`PageStart(0x03,[1]) -> 0x04` → `SetPageSize(0x13,[H,W,01]) -> 0x14` → rows →
`PageEnd(0xE3,[1]) -> 0xE4` → poll `0xA3`→`0xB3` until `page>=1` →
`PrintEnd(0xF3,[1]) -> 0xF4`.

### `b1` post-connect handshake (required)

Validated on a B1 reporting `protocolVersion 3`. Without this exact handshake the
B1 **accepts every setup command but never starts printing**: `PageEnd` gets no
`0xE4`, status freezes at state byte `0x02`, paper never moves. Replicating
niim.blue's connect arms it:

```
PrinterStatusData(0xA5,[1])              -> 0xB5
PrinterInfo(0x40,[sub]) for sub in 08 0b 0d 0a 07 03 0c 09   -> 0x48/0x4B/…
Heartbeat(0xDC,[04])                     -> 0xD9
```

### `b1` row delivery (flow control)

The characteristic is **`WRITE_NO_RESPONSE` only**, so there is no per-write ack.
Blasting the row packets makes the B1 silently **drop rows** → the page is
incomplete → `PageEnd` never acks, or the print stalls mid-label with the paper
oscillating. Inserting a short gap (**~10 ms**, niim.blue's value) between unacked
writes delivers them reliably. The B1 Pro line tolerates the unpaced burst.

### `b1` frame bundling (throughput)

Since every BLE write costs a ~10 ms pace, a dense page (≈one packet per row, when
run-length can't collapse it) is dominated by the *write count*, not the bytes. The
protocol is a frame stream and the printer reassembles it, so several
`[55 55 … aa aa]` frames can be concatenated into **one** write (kept within the BLE
MTU). Bundling row frames up to ~240 B/write cuts a 240-row dense page from ~240
writes to ~60, roughly 4× faster — enough to keep the printer fed so even worst-case
content streams without stalling between labels. niim.blue does **not** bundle (one
frame per write); this is an extra optimization here.

### `b1` copies (identical labels)

To print N identical labels, upload the image **once** and let the printer repeat
it: `PrintStart` declares `pages`=N and `SetPageSize` carries `copies`=N. The status
counter (`0xB3`) climbs 1…N as each copy prints; a single `PrintEnd` feeds out at the
end. This is what niim.blue does for a multi-copy job — the bitmap crosses BLE only
once, so it is far faster than re-sending the image per label. Different labels still
need one upload each (a page per distinct image, all within the one job).

## Identifying the connected model

The B1 and B1 Pro advertise the **same** BLE name (`B1…`), so the name can't tell
them apart. The printer reports its identity, though — query it right after connect
(this is how niim.blue picks the print task):

```
PrinterStatusData(0xA5,[1]) -> 0xB5   # protocol version = data[11]*100 + data[12]:
                                      #   204–299 → 3, 300–301 → 4, ≥302 → 5
PrinterInfo(0x40,[08])      -> 0x48   # model id, big-endian u16 (1-byte resp → byte<<8)
```

| Model id | dec | Model | Protocol | task | dpi | printhead px | Status |
|---|---|---|---|---|---|---|---|
| `0x1000` | 4096 | **B1** | 3 | `b1` | 203 | 384 | ✅ validated |
| `0x1001` | 4097 | **B1 Pro** | 5 | `v4` | 300 | 567 | ✅ validated |
| `0x1200` | 4608 | **M2-H** | 4 | `b1` | 300 | 567 | ✅ validated |
| `0x1002` | 4098 | B1 SE | 3 | `b1` | 203 | 384 | untested |

(Model ids match niimbluelib's table.) The driver runs this on `connect()`, exposes it
as `Niimbot.printer`, and refuses to print when the selected `task`/`dpi` doesn't match
the connected printer. **Flow control is per-model, not per-task:** the 203 dpi B1
drops rows on a full-speed burst so it paces writes (~10 ms gap); the 300 dpi B1 Pro
and M2-H take the unpaced "fast" burst. The M2-H also accepts the `v4` command
sequence, but `b1` (per niimbluelib) is used — `v4` gave no better cadence.

> **Worst-case note:** a *full random-noise* page (every row unique, ~50 % black) at
> 300 dpi sends slower than it prints over BLE (≈12 ms per write, MTU ≈ 247 → ~2 frames
> per write), so the printer can briefly wait between such labels. Real labels (text,
> codes, logos — mostly white) run-length-collapse and stream continuously; for N
> identical labels, `copies` uploads once and never stalls.

## Label geometry

300 dpi ≈ 11.81 px/mm; 203 dpi = 8 px/mm. `SetPageSize` takes `H` (rows, feed
axis) then `W` (cols, printhead axis). Set **`W` = the printhead width**
(B1 Pro 567 px, **B1 384 px**), not the label width: the printer prints columns
`0 … printhead-1` and silently drops the rest. A 50 mm label is 400 px at 203 dpi,
but the B1 printhead is 384 px (≈48 mm) — using `W`=400 loses the rightmost ~16 px
(a right-edge border vanishes); use `W`=384 and print the 48 mm the head supports.

| Code | Printer | task | w_px | h_px | stride |
|---|---|---|---|---|---|
| `T50*30` | B1 Pro | `v4` | 584 | 354 | 73 |
| `T50*30` | B1 | `b1` | 384 | 240 | 48 |
| `T30*45+50` | B1 Pro (cable flag) | `v4` | 354 | 1122 | 45 |
| `T15*50` | D11_H | `v4` | 136 | 590 | 17 |
| `T12.5*74+35` | D11_H (cable flag) | `v4` | 136 | 1287 | 17 |

> B1 `T50*30` (384 × 240) printed correctly on real hardware. `w_px`=384 is the
> full printhead (48 mm); the 50 mm label keeps a ~2 mm unprinted right margin.

## Bitmap encoding

1-bit monochrome, **no dithering** (luminance threshold < 128 = black). Packed
per row, MSB-first, `stride = ceil(W/8)` bytes. Identical consecutive rows are
grouped via run-length (`run`), and blank rows use the dedicated `0x84` opcode —
this drastically cuts the number of BLE packets.

**Row black-pixel count** — both tasks use **total mode**: the three count bytes
are `[00, total_lo, total_hi]`, a single 16-bit black-pixel count. Verified
byte-identical to niim.blue's B1 output. (A 3-chunk "split" count `[c0,c1,c2]`
exists in the wider protocol but is **not** required by the B1 — total mode prints
correctly. The `0x83` indexed-row opcode is likewise unused here.)

## References

- Community / alternative implementation: niim.blue / niimbluelib (`@mmote/niimbluelib`).
