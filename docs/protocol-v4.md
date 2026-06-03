# Niimbot Protocol V4 (D11 / B1 Pro / B21 Pro line)

Reverse-engineered and validated in the lab on the **Niimbot B1 Pro**.
Compatible with the D110_M / D11_H / B1 Pro / B21 Pro line.

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
| `0x21` | SetDensity | `0x31` | data = `[density]` (1–3; 3 = darkest) |
| `0x23` | SetLabelType | `0x33` | data = `[1]` (with gaps) |
| `0x01` | PrintStart | `0x02` | data = `[00 01 00 00 00 00 00 speed 00]` (9 bytes; speed 0/1) |
| `0xA3` | PrintStatus | `0xB3` | data = `[1]`. Response: `page(u16 BE), print%, feed%` |
| `0x13` | SetPageSize | `0x14` | data = `[H_hi H_lo W_hi W_lo 00 01 00×7]` (13 bytes) |
| `0x84` | PrintEmptyRow | — | data = `[row_hi, row_lo, run]` (blank row) |
| `0x85` | PrintBitmapRow | — | data = `[row_hi, row_lo, 0, total_lo, total_hi, run, ...stride]` |
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

## Label geometry (calibrated @ 300 dpi)

| Code | Printer | w_px | h_px | stride |
|---|---|---|---|---|
| `T50*30` | B1 Pro | 584 | 354 | 73 |
| `T30*45+50` | B1 Pro (cable flag) | 354 | 1122 | 45 |
| `T15*50` | D11_H | 136 | 590 | 17 |
| `T12.5*74+35` | D11_H (cable flag) | 136 | 1287 | 17 |

300 dpi ≈ 11.81 px/mm. The `SetPageSize` packet takes `H` (rows) and then `W`.

## Bitmap encoding

1-bit monochrome, **no dithering** (luminance threshold < 128 = black). Packed
per row, MSB-first, `stride = ceil(W/8)` bytes. Identical consecutive rows are
grouped via run-length (`run`), and blank rows use the dedicated `0x84` opcode —
this drastically cuts the number of BLE packets.

## References

- Community / alternative implementation: niim.blue / niimbluelib (`@mmote/niimbluelib`).
