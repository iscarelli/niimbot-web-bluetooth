# Niimbot Protocol V4 (D11 / B1 / B1 Pro / B21 line)

Reverse-engineered and validated in the lab on the **Niimbot B1 Pro** and the
**Niimbot B1**. Covers two print-task variants over the same frame: `v4`
(D110_M / D11_H / B1 Pro / B21 Pro, 300 dpi) and `b1` (B1 / B21 / D11, **protocol
version 3**, 203 dpi). See [Print task variants](#print-task-variants-v4-vs-b1).

> **Validated:** the **B1** (`b1`), **B1 Pro** (`v4`) and **M2-H** (`b1`, 300 dpi) are
> tested on real hardware. The other models listed per family share the protocol and
> should work, but are **untested** — treat their parameters as a starting point.
>
> **One section is validated only in part:** [Consumable status](#consumable-status)
> (the `0xDC`/`0x1A` response layouts). Five of its fields are now confirmed against
> real B1 Pro captures; the rest is still transcribed from niimbluelib and has never
> been seen on a printer here. Which is which is marked field by field, in place and
> in the API (`decoded.evidence`).

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
| `0xDC` | Heartbeat | `0xD9` | data = `[type]`; `04` = "advanced 2". **`b1` handshake**; also read by `getStatus()` — see [Consumable status](#consumable-status) |
| `0x1A` | RfidInfo | `0x1B` | data = `[01]`. Consumable/tag info. **Optional** — many models/consumables never answer. See [Consumable status](#consumable-status) |
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

## Consumable status

Whether the lid is shut, paper is loaded, and what the RFID consumable claims.
Exposed by `Niimbot.getStatus()` (`src/niimbot.js`, section *Consumable status*).

**Trust here is per field, and the API says so.** `getStatus()` returns a
`decoded.evidence` map alongside the values, marking every decoded field:

| Marker | Means |
|---|---|
| `observed` | The byte moved on real hardware here, exactly as the field name says, with the other variables held fixed. **Niimbot B1 Pro (model id `4097`) only.** |
| `varies` | The byte was seen to move with the right physical event, but *what* it measures — or in what unit — is not settled. |
| `inferred` | Not confirmed here. Covers niimbluelib's transcribed names **and** readings these captures support without proving (`printLimit`). |

The rest of this section is the evidence behind those markers, so a reader can
re-derive them rather than take them on faith. Where nothing was observed, the
source is niimbluelib
([`src/packets/abstraction.ts`](https://github.com/MultiMote/niimbluelib/blob/main/src/packets/abstraction.ts),
`processHeartbeatAdvanced1` / `processHeartbeatAdvanced2` / `processRfidInfo`;
opcodes from `src/packets/commands.ts`, `HeartbeatType` from
`src/packets/payloads.ts`, read 2026-08-11).

> ⚠ **The driver still never reads any of it.** No print path calls `getStatus()`
> or branches on it, and that did not change when fields became validated: six
> captures on one model is not enough to refuse a job into a printer that is
> actually loaded. `Niimbot.readiness(status)` *reports*; it is wired to nothing.
> `raw` remains the contract — the exact response bytes, the only part that cannot
> be wrong.

### The captures (Niimbot B1 Pro, model id 4097, 2026-08-11)

Six `0xD9` heartbeats with a 13-byte payload, each recorded next to the printer's
physical state. `c1`–`c4` change one thing at a time against a control; `c5`/`c6`
bracket a 3-label print job 24 seconds apart.

```
        idx0 idx1 idx2 idx3 idx4 idx5 idx6 idx7..12   physical state
c1:     1f   58   50   48   01   01   00   00 …       lid OPEN,   no paper, no tag
c2:     1f   50   50   48   00   00   01   00 …       lid closed, paper in, tag read
c3:     1f   53   50   48   00   01   00   00 …       lid closed, no paper, no tag
c4:     1f   50   50   48   00   00   00   00 …       lid closed, paper in, NO tag
c5:     1f   50   50   49   00   00   01   00 …       22:15:16 — immediately before 3 labels
c6:     1f   4a   50   4a   00   00   01   00 …       22:15:40 — immediately after them
```

What each comparison settles:

- **`idx4` = lid, `idx5` = paper — and they are confirmed *independently*.** `c3` is
  the capture that matters: it holds paper-absent fixed while closing the lid, and only
  `idx4` follows. Without `c3`, `lidClosed = !(idx1 & 0x08)` fit the data equally well.
- **`idx6` = paper RFID read success.** `c2` vs `c4` holds lid and paper fixed and removes
  only the tag; `idx6` is the sole byte that moves. So the tag bit is independent of
  paper, paper detection does not need a tag, and a missing tag is not an error.
- **`idx3` tracks something thermal — but not necessarily in °C.** `0x48` (72) idle,
  `0x49` (73) just before the job, `0x4a` (74) right after three labels. It rises with
  print activity, which is why it is kept; 72–74 is high for °C on a lightly-used
  printhead, which is why the unit is not claimed. Marked `varies`.
- **`idx2` read `0x50` (80) in all six.** Constant is not confirmed, only unrefuted, so
  niimbluelib's `chargeLevel` name stands as `inferred`.

#### Refuted, and recorded so it is not re-derived

**`idx1` is not an error code.** Reading its low nibble as one (`0` = none, `8` = lid
open, `3` = out of paper) fits `c1`–`c4` perfectly and is wrong: `c6` was taken right
after a clean 3-label print with nothing amiss, and reads `0x4a` — low nibble `a`. Across
the six captures `idx1` reads 88, 80, 83, 80, 80, 74 decimal: an analog-looking quantity
that sagged under print load, not an enum. **`idx1` is not decoded and must not be named**
until a capture explains it.

*Open, and explicitly speculation:* `idx1`/`idx2`/`idx3` look like a battery triple —
88 → 80 → 74 decivolts would be 8.8 → 8.0 → 7.4 V, which fits a 2S pack, next to a
charge percentage and a temperature. Nothing here tests that.

**`ribbonInserted` was shipped wrong in 1.4.0.** `idx8` decoded as `ribbonInserted: true`
in every capture — on a B1 Pro, which is direct-thermal and has no ribbon at all. `idx7`
(`ribbonRfidSuccess`) rests on the same unverified offset. Both are **removed** from
`decoded`; their bytes are still in `raw`.

### Heartbeat `0xDC` → `0xD9` / `0xDD`

The request byte is a *type*: `HeartbeatType { Advanced1 = 1, Basic = 2, Unknown =
3, Advanced2 = 4 }`. This driver sends `[04]`, and the response **opcode** — not
the request — says which layout came back:

| Response | niimbluelib name | Decoded here |
|---|---|---|
| `0xD9` | `In_HeartbeatAdvanced2` | yes (payload ≥ 9 B) |
| `0xDD` | `In_HeartbeatAdvanced1` | yes (payload 10 / 13 / 19 / 20 B) |
| `0xDE` | `In_HeartbeatBasic` | no — niimbluelib decodes no fields from it |
| `0xDF` | `In_HeartbeatUnknown` | no |

**Advanced2 (`0xD9`)** — offsets into the payload (after the frame header). The
*Evidence* column is what the API reports, and it applies **only to model id 4097
with a 13-byte payload**; any other model or length drops every field to `inferred`,
because these are absolute offsets and the layout has been seen at exactly one size.

| Offset | Field | Meaning | Evidence |
|---|---|---|---|
| 0 | — | constant `0x1f` in all six captures; not decoded | — |
| 1 | — | **not decoded** — proposed as an error code and refuted, see above | — |
| 2 | `chargeLevel` | battery level (niimbluelib's name; constant `0x50` across the captures) | `inferred` |
| 3 | `temp` | rises with print activity; **unit unverified** | `varies` |
| 4 | `lidClosed` | **`0` = closed**, `1` = open | `observed` |
| 5 | `paperInserted` | **`0` = inserted**, `1` = absent | `observed` |
| 6 | `paperRfidSuccess` | non-zero = tag read ok | `observed` |
| 7 | — | `ribbonRfidSuccess` in 1.4.0; **removed** (see above) | — |
| 8 | — | `ribbonInserted` in 1.4.0; **removed, it was wrong** | — |
| 9+ | `wifiRssi`, `lightingErrorCode`, `voltageState` | optional in niimbluelib; **not decoded here** (endianness/presence unverified — the bytes stay in `raw`) | — |

> **Why the model restriction is not mere caution.** The NIIMBOT Community Wiki says of
> this heartbeat: *"For specific printer models, lid-closed logic is inverted (1 =
> closed)."* Our captures show `1 = OPEN`. So `lidClosed` is a field **known to vary by
> printer** — widening the claim to the B1 (`4096`) or M2-H (`4608`), neither of which has
> ever been captured, could invert its meaning. Source:
> <https://printers.niim.blue/>.

**Advanced1 (`0xDD`)** — never captured here at all; every field is `inferred`. The
layout is keyed off the payload **length**, and each listed length consumes the payload
exactly (niimbluelib's reader errors on leftover bytes), which is the main reason to
trust the transcription:

| Length | `lidClosed` | `chargeLevel` | `paperInserted` | `paperRfidSuccess` |
|---|---|---|---|---|
| 10 | 8 | 9 | — | — |
| 13 | 9 | 10 | 11 | 12 |
| 19 | 15 | 16 | 17 | 18 |
| 20 | — | — | 18 | 19 |

Any other length → **not decoded** (`decoded: null`), never a partially-filled
object. niimbluelib also inverts `lidClosed` for a list of model ids (512, 513,
514, 272, 273, 274, 1792, 2304, 2560, 3584, 3840, 4352, 5120); **none** of the
models in the table above is in it, and the driver applies the same list.

### RfidInfo `0x1A` → `0x1B`

Request data `[01]`. **A missing answer is normal**, not an error: many
models/consumables never reply, so the driver waits ~600 ms and reports
`rfid: null`.

| Payload | Layout |
|---|---|
| exactly 1 byte | no tag present |
| otherwise | `uuid[8]` · `barCode` (u8 length + bytes) · `serialNumber` (u8 length + bytes) · **`printLimit`** (i16 **big-endian**; niimbluelib calls this `allPaper`) · `usedPaper` (i16 BE) · `consumablesType` (u8) · optional `capacity` (i16 BE) |

Unlike the heartbeat, this layout is **self-describing** (length-prefixed strings), so a
field keeps its meaning at any payload size. The evidence below is therefore scoped by
**model** (4097) and not also by length.

#### The captures — two physical rolls on a B1 Pro, 2026-08-11

```
roll A  41 B  88 1d 15 a4 e1 97 00 00 · 08 "11262111" · 10 "PC0G229321004571"
              · 01 14 · 00 06 · 01 · 00 e6
roll B  41 B  88 1d 19 3c 03 13 10 80 · 08 "02272333" · 10 "PJ0H925674000473"
              · 00 78 · 00 03 · 01 · 00 64
```

Both consume the payload with **zero bytes left over** (8+1+8+1+16+2+2+1+2 = 41), which
corroborates the structure. The field meanings settle separately:

| Field | Roll A | Roll B | Evidence | Why |
|---|---|---|---|---|
| `usedPaper` | 6 → **9** | 3 | `observed` | Read immediately before and after a 3-label job on roll A: it moved by exactly 3. Independently backed by the "printed label cnt" block in the wiki's tag map. |
| `capacity` | 230 | 100 | `observed` | The printer's owner confirmed 230 is roll A's label count when new. |
| `printLimit` | 276 | 120 | `inferred` | **Not a paper total.** 276 exceeds the 230-label roll it came off, and it did not move across the print job. `printLimit / capacity` is **exactly 1.2 on both rolls**, and the wiki's tag map lists a *"print limited cnt"* — so the reading is the consumable's DRM cap, provisioned at 120 % of nominal. Two rolls, one model, one label type: a well-supported inference, not a validated field. Source: <https://printers.niim.blue/other/rfig-tags/> |
| `consumablesType` | 1 | 1 | `inferred` | `1` = "with gaps" per <https://printers.niim.blue/other/label-types/>, but it read the same on both rolls — **never observed to vary**, so it is not promoted. |
| `uuid`, `barCode`, `serialNumber`, `tagPresent` | — | — | `inferred` | They differ per roll, but nothing here confirms which value is which. |

> **niimbluelib's `allPaper` name is deliberately not exposed.** A caller reading
> `allPaper: 276` on a 230-label roll would be misled about a quantity of paper; the
> field is surfaced as `printLimit` instead, marked `inferred`. The bytes are unchanged
> and remain in `raw`.

If the payload overruns or leaves bytes over, it is **not** this layout and the
decode returns `null` rather than a guess.

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
