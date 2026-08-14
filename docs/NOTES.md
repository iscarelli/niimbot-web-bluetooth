# Notes

Implementation notes, decisions and gotchas that do not belong in the README (which is
for users of the library) or in `protocol-v4.md` (which is the wire protocol).

## Consumable tags: what the RFID barcode actually is

Read from a B1 Pro on 2026-08-13, four rolls, via the demo's *Read status*:

| `barCode` | `serialNumber` | label | `capacity` | note |
|---|---|---|---|---|
| `11262111` | `PC0G229321004571` | 50 × 30 mm | 230 | 8 digits — **not** an EAN-13 |
| `10262260` | `PZ1G328306001390` | 50 × 30 mm, white | 230 | 8 digits — **not** an EAN-13 |
| `6975746632324` | `PC0G428336001192` | 30×45+50 cable flag, **white** | 80 | EAN-13 ✔ product `63232` |
| `6975746632331` | `PC0G513326003085` | 30×45+50 cable flag, **yellow** | 80 | EAN-13 ✔ product `63233` |
| `6975746632348` | `PC0G403350000212` | 30×45+50 cable flag, **red** | 80 | EAN-13 ✔ product `63234` |
| `6977031215465` | — | 25×38+40 cable flag, **blue** | — | EAN-13 ✔, prefix `6977031` (a different maker) |

**There are two coding schemes on these tags, and they behave differently.** This matters
because it decides whether registering one roll covers every future roll of the same
product, or only that roll.

**13 digits — a GTIN, i.e. a product code.** All four are valid EAN-13 (check digit
verified). The three cable flags share the maker prefix `6975746` and carry *consecutive*
product numbers `63232` (white) / `63233` (yellow) / `63234` (red) — three rolls of
identical geometry differing only in colour, which is exactly how a manufacturer numbers
SKU variants. The 25×38 blue has a different prefix (`6977031`), a different maker, and
is also a valid EAN-13. For these, a `barCode → { size, colour }` table generalises to
the SKU and is shareable between users.

**8 digits — a different scheme, and not decoded.** Two 50 × 30 rolls of 230 labels carry
*different* 8-digit codes (`11262111`, `10262260`). Nothing here says what those digits
mean.

**The operating rule is the maintainer's, and it needs no theory: a different code is a
different label.** Register it and move on. That is also the only rule that stays correct
whichever way the schemes turn out, which is why no code here tries to infer that two
barcodes are "really" the same consumable.

`serialNumber` identifies the individual roll in both schemes: it differs on every roll
above and carries what look like batch/date codes.

Three limits, all worth respecting:

- The GTIN reading is inference **from the format of the code**, not an observation. The
  direct confirmation — two physically different rolls of the SAME SKU showing the same
  `barCode` with different `serialNumber` — has not happened. An attempt on 2026-08-13
  produced two identical records (same `serialNumber`, same `usedPaper`): the same roll
  read twice, which confirms nothing.
- Whether two 8-digit rolls of the same dimensions are the same product is
  unestablished and is **not assumed anywhere**: their serials start `PC0G` and `PZ1G`,
  different prefixes, and the rule above (different code ⇒ different label) means
  nothing depends on the answer.
- **Scope: one printer (a B1 Pro) and the six rolls above, on 2026-08-13.** Nothing here
  has been checked against another printer model or another label range.

**Why it matters:** keying the demo's label memory by `barCode` is correct, and a
`barCode → { size, colour }` table is in principle **shareable between users** rather
than personal. Colour is per-SKU here — each colour is its own GTIN. The RFID payload
itself carries **no colour field**: it is fully accounted for by
`uuid · barCode · serial · printLimit · usedPaper · consumablesType · capacity`
(`src/niimbot.js:464-465`), with zero unparsed bytes.

## Printhead width: one contradiction resolved, one still open

`docs/protocol-v4.md` § *Label geometry* says to set `W` = **printhead width, not label
width**, and gives the B1 Pro's as **567 px**. Both halves conflict with what is
elsewhere in the repo:

1. The same table's cable-flag row uses `w_px` = **354** for `T30*45+50` — the **label**
   width (30 mm), not a printhead width. So the stated rule does not hold for labels
   narrower than the head, and nothing says where the boundary is.
2. `registry.json` uses **584** for the B1 Pro (`T50x30`) and attributes **567** to the
   **M2-H** (`T50x30_m2h`, with a `_note` saying so). The prose gives 567 to the B1 Pro.

**RESOLVED for the M2-H (2026-08-13): 567 was never a printhead width.** Solid black at
**584** printed **edge to edge** on the M2-H, so its head reaches at least 584. The real
reason for 567, from the maintainer: **the M2-H is a THERMAL TRANSFER printer — it uses a
ribbon** (unlike the direct-thermal B1 Pro), the ribbon drifts slightly, and 567 is a
deliberate ~1.4 mm right margin that absorbs the drift. Someone later wrote "printhead
width" beside the number as an explanation, and that invented explanation then spread.
Both `_note` fields in `registry.json` are corrected; the **value 567 stays**, because
the value was right for a reason nobody had written down.

**STILL OPEN for the B1 Pro.** `docs/protocol-v4.md` attributes 567 to the *B1 Pro*, and
that attribution now has no support at all: the only 567 in this project traces to the
M2-H's ribbon margin. The same solid-black test has not been run on a B1 Pro, so its head
width remains unmeasured. Tracked on Vikunja (#970).

**Lesson worth more than the fix:** a correct number carried a wrong explanation for
months, and the explanation was the part that got reused. When a constant exists for a
physical reason, write the reason next to it — otherwise someone reconstructs a plausible
one and it becomes doctrine.

## Cable flags: `h_px` is the area you want to print, not the label's full pitch

`docs/protocol-v4.md:370` lists `T30*45+50` as 354 × **1122** px — 30 × **95** mm, i.e.
the flag (45 mm) *plus* the transparent tail (50 mm). Reading that table, it is natural
to assume the full pitch is required and that a shorter `h_px` would desynchronise the
feed.

**It is not required.** Measured on a B1 Pro, 2026-08-13, on **two different consumables**:

| size printed | `w_px × h_px` | roll | result |
|---|---|---|---|
| 30 × 45 mm | 354 × 531 | 30×45+50 | two labels in a row, both filling the flag |
| 25 × 38 mm | 295 × 449 | 25×38+40 | two labels in a row, both filling the flag |

In both, the label *after* the first came out registered, which is the half that matters:
had the short `h_px` desynchronised the feed, the second label would have drifted. The
printer registers on the gap itself, so `h_px` selects **how much area you are printing**,
not how far the paper must advance.

That makes 1122 and 531 both valid, for different intents — print across the tail, or
print the flag only — and the choice belongs to the caller, like every other size
decision (`CLAUDE.md`, *Project constraints*: the driver reads models and sizes from the
caller). What the driver will not do is lay out around the fold; it prints the whole
area it is handed, and where the fold lands is the application's problem.

Both flag-only variants ship in `registry.json` as `T30x45` and `T25x38` (2.0.0). What
does **not** ship, and stays arithmetic nobody has put on paper, is the **full-pitch**
reading — the 1122 px figure in the protocol doc. Printing across the transparent tail
has never been tried.

## Write mode: `"fast"` is an unmeasured default, and the default is not the problem

Everything measured so far, on 2026-08-13 unless noted. The point of the table is the
column that is empty.

| what printed | content | platform | write mode | result |
|---|---|---|---|---|
| demo test page | dense (diagonals) | non-Mac desktop (`mac=false`) | `fast` (auto) | **nothing on paper**, driver rejected |
| demo test page | dense | same machine | `paced` | printed |
| 5-label stress | dense (noise) | iPhone | `fast` | **4 of 5**, raster truncated, all numbered 1 |
| 5-label stress | dense | iPhone | `paced` | 5 correct |
| 25×38 and 30×45 flags | medium | Mac (⇒ `paced`) | auto | printed |
| **5-label stress** | **dense (noise)** | connect line said **`mac=false`** | **`paced`** (override) | **nothing on paper**, rejected at page 1 |
| **5-label stress** | **dense (noise)** | connect line said **`mac=true`** | **`paced`** (auto) | **5 correct, numbered 1–5** |
| macOS, historical (v1.3.3/1.3.4) | — | macOS | `fast` | blank page reported as 100% |
| rackplan label, 1st production run | **sparse** (12 % black) | **unrecorded** | auto | **failed** (`Failed to write to BLE`) |
| rackplan label, later run | **sparse** | **unrecorded** | auto | printed |

**Zero confirmed successes in `"fast"`.** Every success above either ran `paced` or ran
on a machine whose OS nobody recorded — and with `WRITE_MODE` unset, the effective mode
IS the platform (`IS_MAC` downgrades `fast` → `paced` at `src/niimbot.js:359`), so an
unrecorded OS means an unrecorded mode.

**The two 5-label runs were the SAME machine and browser, and the difference is
UNEXPLAINED.** The maintainer states that all testing was done on one Mac in Chrome.
The two runs are four minutes apart:

    22:02  detected=fast   mac=false   → override paced → nothing on paper, rejected at page 1
    22:06  detected=paced  mac=true    → auto            → 5 correct labels, numbered 1–5

`IS_MAC` is computed **once at load**, so a Mac reporting `mac=false` means `navigator`
itself reported something non-Mac in that session — DevTools device emulation, an
extension, a spoofed agent. Nothing recorded which, because at the time the log printed
only the boolean. That is now fixed: the connect line carries the inputs
(`mac=… [uaData="…" platform="…"]`, added 2026-08-13), so a recurrence explains itself.

**What this does NOT support**, and what an earlier version of this page wrongly claimed:

- Not "Mac vs Windows" — there was one machine.
- Not "the platform matters even with the write mode held constant" — there was one
  platform.
- Not "density is the trigger, so pace everything" — the failing run was already paced.

**What survives:** a job in `paced` produced nothing on paper and the driver rejected it
truthfully, and a job in `paced` four minutes later printed five correct labels. Whatever
differs between them is not the write mode and is not the machine. It is not known.

**Consequence for the default:** it stays `fast`, because nothing here identifies a
change that would have helped. Flipping it would be acting on a story, and the story
this page told for most of 2026-08-13 turned out to be wrong twice.

(The earlier reading on this page — "density is the trigger, so pace everything" — was
mine, and it was wrong for this reason. The rackplan session objected first, on the
grounds that the deciding rows had an unrecorded platform; the measurement then showed
the platform matters even when the mode is held constant.)

What the driver can do instead is what 2.0.0 already does: make the failure **visible**
(a rejection naming what stalled, and the connect line stating detected/effective mode
without needing DEBUG) and make every rung **reachable** (`WRITE_MODE`, including
`"acked"`, which 1.4.0 could not select at all). Climbing the ladder is the
application's job — the rackplan built exactly that, and it is the right shape.

Still untested anywhere: `"acked"` on real hardware. It is the one rung nobody has put
on paper, and it is the obvious next thing to try on a machine that fails in `paced`.

**What settles it:** one print on Windows and one on a Mac, reporting
`modo_detectado`/`modo_efetivo`. The rackplan now logs both per print (table
`impressoes_niimbot`, created 2026-08-13 in response to exactly this gap), so the next
two prints answer it by measurement rather than reconstruction.

**The cost asymmetry, which is why the default has not been flipped "just in case"
either way.** Unnecessary `paced` costs speed for everyone (~3× on dense pages, measured
from the batch logs); wrongful `fast` costs a wrong label. Since 2.0.0 the *measured*
`fast` failures reject loudly rather than reporting success — but that protection is not
total: a page whose rows are partly dropped while PageEnd still acks and the counter
still advances would print short and resolve fine. So the asymmetry is reduced, not
removed.

## Baseline: a healthy 5-page batch, `paced`, B1 Pro (2026-08-13, 22:25)

Kept as numbers rather than the raw trace. Full DEBUG packet dump was captured at the
time; what mattered is here.

Job: 5 dense-noise labels, 50 × 30 (584 × 354), `effective=paced`, `PACE_MS = 10`,
`bundle=false`, `mac=true [uaData="macOS" platform="MacIntel"]`. **All five labels came
out correct on paper.** Protocol-wise: every `0xE3` answered by `0xE4`, page counter ran
0 → 5, `PrintEnd` acked, 16.4 s total.

| page | row-writes | time to send |
|---|---|---|
| 0 | 177 | 2.29 s |
| 1 | 255 | 3.14 s |
| 2 | 273 | 3.41 s |
| 3 | 226 | 3.01 s |
| 4 | 239 | 2.96 s |

**~12 ms of wall clock per row-write, against `PACE_MS = 10`** — so the send time is
essentially the pacing, not the data. The printer finished page 3 at t+12.35 s while
page 4 was still being sent (finished t+15.33 s), i.e. **the printer waits for the
driver**, and that idle is the inter-label pause visible on the paper path.

**Why this matters for tuning:** `PACE_MS` cannot simply be lowered — it is the margin
that stops rows being dropped. The lever that costs nothing is **fewer writes**, i.e.
frame bundling (`BUNDLE_MAX`), which packs several frames into one BLE write and
therefore pays the gap once per bundle instead of once per row. Bundling is enabled for
the B1 (4096) and M2-H (4608) and **disabled for the B1 Pro (4097)** — see `MODEL_IDS`
in `src/niimbot.js`. The comment there says bundling is on "only where validated", so
the B1 Pro's `false` records an absence of testing, not a known failure.

**There is currently no way to test that.** `Niimbot.BUNDLE_MAX` is exposed, but the
per-model gate `_bundleAllowed` is not, and `max = _bundleAllowed ? BUNDLE_MAX : 0`
means the exposed knob does nothing on a B1 Pro. Making the gate overridable is the
prerequisite for measuring whether bundling removes the pause there.

**For comparison when a failure is next captured**, one difference between this healthy
trace and the failing `fast` run of 13:53 is recorded without interpretation: here the
printer emitted sparse `0xD3` notifications during row streaming (`01 2b 01`,
`01 61 01`, `00 95 01`); there it emitted **hundreds** of `0x14 (01 00)` — the
SetPageSize ack, of which one per page would be expected — arriving seconds late. What
that means is unknown.

### The pause is write count × `PACE_MS`, and nothing else (measured pair)

Same printer, same size, same mode, same batch length — only the content differs. The
light run was printed to test a prediction made in advance (that the pause would shrink
or vanish), so it could have falsified it.

| | dense noise | light label |
|---|---|---|
| row-writes per page | 177–273 | **50** |
| send time per page | 2.3–3.4 s | **~0.74 s** |
| whole 5-page job | 16.4 s | **6.2 s** |
| inter-label pause on paper | visible | **none** |

Run-length collapses a 354-row light label into 50 writes. Subtracting the SetPageSize
round trip (~110 ms) and PageEnd (~55 ms) leaves ~580 ms for 50 writes = **11.6 ms
each**, against `PACE_MS = 10`. The send time is the pacing; the payload is negligible.

**The bottleneck inverts, which is what removes the pause.** In the light run the driver
finished sending page 4 at t+4.0 s while the printer had only completed page 2 at
t+3.3 s, and then spent t+4.0→6.2 s polling — i.e. waiting for the printer. In the dense
run the reverse held. A pause between labels means the driver is behind; nothing else.

**Consequence:** the pause is not a property of `paced`, it is a property of
writes-per-page. Reducing writes (frame bundling) attacks it directly; lowering
`PACE_MS` attacks the safety margin instead. See the note above on `MODEL_IDS`, where
bundling is off for the B1 Pro for want of testing.

## M2-H: first real capture (2026-08-13)

Detected and printed correctly on the first try: `identified Niimbot M2-H (id=4608,
proto=4, task=b1, name="M2_H-H107060027")`, `bundle=true`, `effective=paced` (on a
`mac=true` host). A 5-label light batch printed with every `0xE3` acked and the counter
running 0 → 5.

**Bundling works, and this is the first time it ever ran.** It is enabled only for the
B1 (4096) and M2-H (4608), and neither had been exercised. The packet log cannot show it
— `logTx` counts FRAMES, not BLE writes — but the clock can:

| | ms per row-frame, light label |
|---|---|
| B1 Pro, `bundle=false` | 11.5 |
| M2-H, `bundle=true` | **5.7** |

50 frames in 287 ms. One write per frame at `PACE_MS = 10` would cost ~500 ms, so ~28
writes carried 50 frames — about 1.8 frames per write, and the send time halves.

**Heartbeat and status use DIFFERENT lengths from the B1 Pro**, which is why
`src/niimbot.js` refuses to extend its hardware claim past model 4097:

    heartbeat 0xD9:  B1 Pro 13 bytes   ·  M2-H 11 bytes
    status    0xB3:  B1 Pro 11 bytes   ·  M2-H 10 bytes

Captured M2-H heartbeats (physical state at capture NOT recorded — see below):

    1f 6c 04 49 00 00 01 01 00 00 00
    1f 6e 04 4a 00 00 01 01 00 00 00

`decodeHeartbeat` accepts any `0xD9` of ≥ 9 bytes, so it produces `layout:
"advanced2/11"` — but marks every field `inferred`, because `observed` requires
`n === 13`. That restraint looks right here: applying the 13-byte offsets gives
`chargeLevel` = 4 on the M2-H against 80 on every B1 Pro capture. An 80 → 4 swing in the
same slot is as easily a different layout as a different battery, and nothing here
separates the two.

**What would make these bytes usable:** the same discipline the B1 Pro captures had —
record the raw bytes *alongside the physical state* (lid open/closed, roll in/out, tag
present/absent). Three `Read status` calls with the lid and roll deliberately varied
would do it, and cost no labels.

**RFID on this printer's rolls:** barcodes `6977031213447` and `6977031213522`, both
13-digit, both maker prefix `6977031` — the same prefix as the 25×38 blue flag, and a
different one from the 30×45 family. Their payload is 44 bytes and ends after
`consumablesType`, i.e. **no `capacity` field** (the B1 Pro's rolls carried one). The
driver already treats capacity as optional (`if (left() === 2)`), so this is a
confirmation of that guard rather than a surprise.

## Lead: `ribbonInserted` may be real after all — d[7] tracks the ribbon

`ribbonInserted` and `ribbonRfidSuccess` were removed from `getStatus().decoded` earlier
on 2026-08-13 because they read `true` on a B1 Pro, which is direct-thermal and has no
ribbon at all. That removal stands: the field as decoded was confidently wrong.

But the M2-H **does** use a ribbon, and the two captures differ in exactly one plausible
place:

    idx      0   1   2   3   4   5   6   7   8   9  10  11  12
    B1 Pro  1f  3e  50  4a  00  00  01  00  00  00  00  00  00     no ribbon
    M2-H    1f  6b  04  49  00  00  01  01  00  00  00             has ribbon

`d[7]` is `00` on the printer without a ribbon and `01` on the printer with one. One
sample each, and the two layouts differ in length (13 vs 11 bytes) so the offsets may not
even correspond — this is a lead, not a decode, and nothing in the driver acts on it.

**The test that would settle it costs no labels:** on the M2-H, *Read status* with the
ribbon fitted, then **take the ribbon out** and *Read status* again. If `d[7]` goes
`01 → 00`, the field is real and belongs back in `decoded` — scoped to models that have a
ribbon, and marked `observed` only for those actually captured.

## M2-H info space, swept (2026-08-13)

Probed with `Niimbot.probe()` on an M2-H. Unsupported sub-codes answer with opcode
**`0x00`, data `01`** — a clear "not supported", which is what makes a sweep readable.

**`0x1A` (RfidInfo) IGNORES its parameter.** `1a[02]`, `[03]`, `[04]` and `[05]` all
return the byte-identical paper-roll payload that `1a[01]` returns. Whatever the official
app reads for the ribbon, it is not a second RFID tag behind this command.

Answers the b1 handshake never asks for:

| request | response | value | read |
|---|---|---|---|
| `40[01]` | `41` | `03` | unexplained |
| `40[06]` | `46` | `02` | unexplained |
| `40[0e]` | `4e` | `02` | unexplained |
| `40[0f]` | `4f` | `00 1a` (26) | unexplained |
| `dc[01]` | `dd` 13 b | `1f 56 00 0b 00 0b 00 00 4b 00 04 00 01` | heartbeat *Advanced1* |
| `dc[02]` | `df` 12 b | all zeros | unexplained |
| `dc[03]` | `de` 10 b | `01 01 01 36 02 40 03 02 01 00` | unexplained; note `01 36` also appears as `40[09]` |

Already known from the handshake: `40[08]`=model id, `40[09]`=`01 36`, `40[0a]`=`04`,
`40[0b]`=serial, `40[0c]`=`01 01`, `40[0d]`=`02 11 07 06 00 27`, `a5`→`b5`.

**The value 4 recurs in three places** — Advanced2 `d[2]`, Advanced1 `d[10]`, and
`40[0a]` — all of which the driver or niimbluelib call charge level. It did **not**
change when the ribbon was removed entirely, so it is not the ribbon.

### Remaining ribbon: not in the space swept so far (2026-08-13)

The official NIIMBOT app shows how much ribbon is left, so the information exists
somewhere. It is not in anything this driver can ask for.

The full sweep was run twice on the same M2-H, minutes apart, with **two different
ribbons** — one roughly half spent, one brand new:

    0x1A[01..05]   RfidInfo (all parameters)
    0x40[00..20]   the whole info sub-code space
    0xDC[01..05]   every heartbeat variant that answers
    0xA5           PrinterStatusData

**Every response was byte-identical between the two ribbons.** The only bytes that
differed are `d[1]` and `d[3]` of the heartbeat, and neither is usable: both drift on
their own — `d[1]` changed with nothing touched at all, and `d[3]` moved `4b → 4c`
between two reads **60 ms apart in one session**.

So a caller can know *whether* a ribbon is fitted (`getStatus().decoded.heartbeat
.ribbonInserted`) but not *how much is left* — not from this space. Re-probing the same
commands will not change that; widening the search might.

**Scope of the negative.** It covers the commands that are safe to sweep — reads. The
top-level opcode space was deliberately NOT swept: it contains commands that print, feed,
write RFID and update firmware, and probing those blind risks the printer. So this rules
out the readable space, not the protocol.

**The figure DOES come from the printer.** A guess that the app might compute it from
accumulated usage was refuted the same evening: the maintainer installed the app fresh on
a phone — no history of any kind — and it showed the correct level as soon as the
cartridge was swapped. So the value is readable; this sweep simply did not reach it.

**What is left.** With `0x40` exhausted, `0x1A` ignoring its parameter, `0xDC` and `0xA5`
identical across cartridges, the readable command space this driver can reach is spent.
The remaining approach is not more probing — it is **capturing what the official app
sends**, which is how this protocol was mapped in the first place. On Android that is
Developer options → *Enable Bluetooth HCI snoop log*, use the app, pull the log, read it
in Wireshark; the command appears directly. One place also remains unlooked-at:

- ~~`0x40` beyond sub-code `0x20`~~ — **swept, 2026-08-13, and exhausted.** Every
  sub-code from `0x21` to `0xFF` answers `00 01` ("not supported"), run twice: once with
  a half-spent cartridge and once with a fresh one. Only `0x00–0x20` respond at all, and
  those are byte-identical between the two. The `0x40` family holds nothing about ribbon
  quantity.
- **Other GATT characteristics.** The driver uses the one service and one characteristic
  that niimbluelib uses. The printer may expose more. Web Bluetooth will not enumerate
  services that were not declared in `optionalServices` before connecting, so this needs
  a list of candidate UUIDs first — it cannot be discovered blind from the browser.

**Why this is written down.** A negative result that nobody records gets re-derived. This
sweep cost an evening; the next person to wonder where ribbon level lives should read
this instead of repeating it.

## The printer reports its own printhead width — `dc[03]`, bytes 4-5

Found while bringing up the D11_H, 2026-08-13. `probe(0xDC, [0x03])` answers `0xDE` with
ten bytes, and the third 16-bit field is the printhead width in pixels:

    M2-H    de:  01 01  01 36  [02 40 = 576]  03 02 01 00
    D11_H   de:  04 01  04 1c  [00 90 = 144]  03 02 01 00

**Confirmed on the D11_H by measurement.** Solid black sent at 177 px and at 144 px came
out *exactly the same width* — both clipped at the same limit — while 136 px came out
visibly narrower. So the head is 144, which is what `dc[03]` said.

(The first two fields of `de` are not new: they repeat `40[0c]` and `40[09]`.)

**This retracts something claimed earlier today.** The M2-H note said its head "reaches at
least 584" because solid black at 584 printed edge to edge. `dc[03]` says **576**, and
584 − 576 = 8 px = **0.68 mm** — well inside what "it reached the edge" can hide on a
50 mm label. The observation was real; the conclusion drawn from it was too strong. The
same comparison test would settle it: print solid black at 584 and at 576 and see whether
the bands are identical.

**And it makes Vikunja #970 answerable with no labels at all.** The open question is
whether the B1 Pro's head is 567 or 584. Connect a B1 Pro and run:

    await Niimbot.probe(0xdc, [0x03])

Bytes 4-5 of the reply are the answer. Confirm it the same way if it matters: two solid
blacks, one at the reported width and one above it, and compare.

## What a label costs to send: stress vs realistic, measured (2026-08-14)

Same printer (B1 Pro), same label (`T40x60`, 472 × 709), same Mac, two minutes apart —
the demo's *stress* artwork and its *realistic* one:

    realistic   142 row-writes   upload 1.7 s   total 4.4 s
    stress      589 row-writes   upload 6.8 s   total 8.6 s

**4.1× the writes, 4.1× the upload.** Nothing else moves, because the cost of an upload is
`PACE_MS × writes` and nothing else — the same relation the 5-page batch measurement found.
The difference in the artwork is one thing: the stress label's corner-to-corner diagonals
touch nearly every row, so run-length encodes 589 packets for 709 rows — one per row. The
realistic label is bands of identical rows and collapses 4×.

**Do not compute print time by subtracting the upload.** The printer starts printing while
data is still arriving: when the stress upload finished, the page was already **36% printed**,
so the 1.1 s that followed is a remainder, not a cost — and quoting it as "1.1 s to print"
(as an earlier version of the `T40x60` note did) understates the mechanical time by half.
The clean figure comes from the realistic run, where the upload finishes first and the print
then takes **~2.3 s**. That is what 709 rows of feed costs on this printer.

Consequence for anyone benchmarking this driver: **measure end to end, and say which artwork
you used.** A "how fast is it?" answer without the packet count is unreproducible — the same
label, same printer and same second can differ 2× on total time purely by what is drawn.

## Density 1–5 on the D11_H: five labels, no visible difference (2026-08-13)

The driver gained a per-print `density` (1–5, the scale the official app shows). The first
thing printed with it was a control: the same solid-black 144 × 354 label five times, the
density value in white in the middle, one label per value.

**All five came out identical.** No change in blackness, no bleed at 5, no washing out at 1.

That is an observation, not a conclusion, and it has two very different explanations:

1. **The test can't see it.** Solid black is saturated by definition — on direct thermal,
   more heat cannot make a fully-burned dot blacker. Density shows up in *thin* features:
   hairlines closing up, small text filling in, the back of the label marking. A black
   rectangle is the least sensitive target that could have been chosen.
2. **The printer ignored it.** `0x21` is acked (`0x31`), but an ack means *parsed*, not
   *applied* — the D11_H is a new model here and nothing has verified it honours the field.

**The discriminator needs no labels: read the value back.** `0x40[0x01]` is Density in
niimbluelib's info enum, and the driver's own sweep skips it (`src/niimbot.js:438` reads
`08 0b 0d 0a 07 03 0c 09`). Set, then read:

    await Niimbot.identify(reg.models.d11h);
    const info = async () => (await Niimbot.probe(0x40, [0x01], 800));
    console.log('antes', await info());
    await Niimbot.probe(0x21, [1], 800);  console.log('após 1', await info());
    await Niimbot.probe(0x21, [5], 800);  console.log('após 5', await info());

The test validates itself: if the returned byte *tracks what was set*, it both identifies
the field and proves the printer took the value.

### Answered — and the answer was a third explanation nobody listed (2026-08-14)

`0x40[0x01]` → `0x41` **is the density**, and it follows what is written, on a D11_H:

    read → 03      (the registry default)
    0x21 [01] → ack 0x31 01,   read → 01
    0x21 [05] → ack 0x31 01,   read → 05
    0x21 [03] → ack 0x31 01,   read → 03

So the field is identified by measurement rather than by trusting an enum, and hypothesis
(2) is dead: this printer accepts and stores the value.

But the same log killed hypothesis (1) as the *explanation*, because it also carried this:

    conectado → {"modelId":528, "label":"unknown (id 528)", "task":null, "dpi":null}

Model 528 has been in `MODEL_IDS` since `e42d94e`. A driver that answers "unknown" to it is
**older than that commit** — and therefore older than `288b6ae`, nine minutes later, which
is what added the `density` option at all. The tab had been open across the deploy, so it
was still running the driver it loaded at page load (the `?t=` cache-buster in
`demo/index.html` is resolved once, when the page loads — it cannot help a tab nobody
reloaded). **That driver ignored `{ density: d }` and sent the model's 3 five times.**

Five identical labels, because five identical labels were printed.

Two lessons worth more than the density answer:

- **A stale tab does not fail; it succeeds at being slightly old.** Nothing errored. The
  new option was silently dropped, and the missing effect got attributed to the printer —
  a hardware conclusion drawn from a caching bug. The version was on screen in the log
  (`[demo] loaded Niimbot driver version:`) and in the tab title the entire time. It is now
  also a badge next to the demo's `<h1>`, because a fact you must remember to look up is
  a fact you look up after you need it.
- **When a measurement disagrees with the code you just wrote, first prove the code is the
  code that ran.** Cheaper than every hypothesis about the hardware, and here it was the
  answer.

### The printer applies it — the print gets SLOWER (2026-08-14)

Second, independent confirmation, and this one is about the paper rather than a register.
Timing the printer's own counter from `page 0` to `page 1`, same label, same tab, minutes
apart:

    density 1   171 image rows   1288 ms
    density 3   182 image rows   1350 ms
    density 5   179 image rows   1592 ms

Monotonic, and **the content does not explain it**: density 3 sends *more* rows than 5 and
still finishes sooner. More heat means more dwell per line, so the head runs slower. Whatever
`0x21` does, it reaches the mechanism.

A later run removed even that caveat, by accident — densities 3 and 5 happened to encode to
**the same row count**, making it a controlled pair:

    density 3   139 image rows   1320 ms
    density 5   139 image rows   1562 ms     (+18%)

Identical payload size, 242 ms apart. **Practical consequence for callers, and it belongs in
the README rather than here alone: turning density up makes the print slower**, and on a
batch that cost is paid per label.

### Designing the target: at 300 dpi a pixel is 0.085 mm, and screen intuition is wrong

The first sensitive target was useless too, for a reason worth writing down because it is
pure arithmetic:

- **Text.** `px = pt ÷ 72 × 300`. So 8 pt is **33 px**, not 8. Asking for `8px sans-serif`
  produced **2 pt** type — printed, legible under a lens, useless to compare.
- **Line pairs.** 1 px on / 1 px off at 300 dpi is **150 lp/in**. The head cannot resolve it
  and neither can an eye at 12 mm. Three test blocks came out as three flat grey bars — the
  pattern was below the printer's resolution, which says nothing about density.

- **Overflow.** A `<canvas>` accepts drawing past its bounds without a word — no exception,
  no warning, the pixels simply are not there. The step-wedge card's last text line was laid
  out at y 332…365 on a 354 px canvas and printed with the bottom third of its glyphs gone,
  which reads as a printing defect rather than an arithmetic one. Any generator that stacks
  blocks should carry a cursor and **throw** when the next block will not fit; hand-summed
  offsets are how the 11 px got there.

**The target that works is a step wedge in both polarities:** bars of 1, 2, 3, 4, 6, 8 px,
once black-on-white and once knocked out white-on-black, plus the same 8 pt word set solid
and reversed. Reversed detail is the sensitive half — extra heat spreads the dot and *closes*
white gaps, so the reading is a count ("at density 5 the 1 px and 2 px white bars are gone"),
not an impression of darkness. A 15 × 30 mm label fits six steps of each with room for a
heading.

**Still unmeasured: what density does to the paper.** Two register-level and one timing-level
confirmations say the printer honours it; nobody has yet compared two labels and named the
difference.

## D110 bring-up: four protocol behaviours nothing here had seen (2026-08-14)

Model id **2304**, advertised `D110-FC06023035`, 203 dpi, `b1` task. All four below come
from one capture on Windows/Chrome; none of them is decoded or documented anywhere else in
this project.

**`0xD3` is a row-received counter, and it is the thing this project has always wanted.**
During the image upload the printer volunteered, unasked:

    d3: 00 c7 01     ->  199
    d3: 01 8f 01     ->  399
    d3: 02 4e 01     ->  590

591 rows were sent. **The printer is reporting how many rows it actually received.** The
characteristic failure of this driver — the one that broke v1.3.3 and v1.3.4 — is rows
dropped silently while progress reports 100 %, and the whole reason `PACE_MS` exists is
that BLE writes go out unacked. Here is a count coming back from the other side of the
radio. Nothing reads it yet; the driver files it into `lastUnsolicited` and drops it.
Whether the other models emit it has not been checked — the B1 Pro captures predate anyone
looking for it.

**`0xDB` is a rejection — "busy", not "wrong task".** First seen driving the D110 as `v4`,
where `0xdb 06` arrived twice: after the 13-byte `SetPageSize` (which never got its `0x14`)
and after `PageEnd` (never got its `0xe4`).

**An earlier version of this note said it never appears under the `b1` task. That was
wrong, and it was written from a single-label capture.** A 3-label batch on the `b1` task
(2026-08-14, 11:02) produced `0xdb 06` twice more — and there the task was never in
question, because the same connection had just printed a single label cleanly. What the
batch adds is the tell: the rejection lands on whichever command arrives after the printer
considers the job over (`SetPageSize` on page 1, `PageEnd` on page 2 — see *D110: every
multi-label path fails*, below).

So `0xdb` is the printer refusing a command it cannot service right now; `06` is presumably
the reason and is not decoded. Worth knowing because the refusal is otherwise invisible —
the driver files it into `lastUnsolicited`, drops it, and reports a timeout instead of the
"no" it was actually given.

**`0xA5` answers with 2 bytes on this model, so protocol detection yields `null`.**
`detectPrinter` (`src/niimbot.js:321`) requires ≥ 13 bytes of `PrinterStatusData` to derive
`protocolVersion`; the D110 replies `b5: 30 30`. Harmless — the task comes from the
registry, not from the protocol version — but `printer.protocolVersion` is `null` for this
model and no amount of retrying changes it.

**The heartbeat answers with opcode `0x00`, not `0xD9`.** `b1Handshake` and `getStatus`
send `0xdc [0x04]` and wait for `0xd9`; the D110 replies with cmd `0x00`, payload `01`. The
wait therefore always times out — **1 s burned on every status read on this model** — and
`decodeHeartbeat` returns null because the layout is picked by the response opcode. The
RFID half (`0x1a` → `0x1b`) works normally, which is why the roll tag reads fine while the
heartbeat is empty.

**Not tried, and it would have saved the ruler:** `probe(0xDC, [0x03])` (see *The printer
reports its own printhead width*, above) should report the D110's head directly. The 96 px
in `registry.json` was inferred instead — 120 px sent, clipped at 12 mm measured. Running
the probe would give a second, independent source for the same number, and it needs no
labels.

## D110: every multi-label path fails — one page per job (2026-08-14, open)

A **single** label prints clean on the D110 (`96×400`, page 1 / 100 % / 100 %) and is
confirmed on paper. **Both** multi-label paths fail, and they fail differently.

### `copies` is not honoured

`Print 3 copies (1 upload)` — the path where the bitmap crosses BLE once and the printer
repeats it internally. Everything was accepted:

    01 (7b) 00 03 …          PrintStart, pages = 3        -> 02 ✔
    13 (6b) 01 90 00 60 00 03  SetPageSize, copies = 3    -> 14 ✔
    …one image…  e3          PageEnd                      -> e4 ✔

**One label came out.** The counter reached `00 01 64 64` — page 1, print 100 %, feed 100 %
— and then sat there, unchanged, for the full `PAGE_WAIT_MS` (25 s, ~100 polls), before the
job was declared unconfirmed at "page 1 of 3". The printer acked a request for three copies
and delivered one.

### The 3-label batch is rejected mid-job

| page | PageStart `0x03` | SetPageSize `0x13` | PageEnd `0xE3` |
| --- | --- | --- | --- |
| 0 | `04 01` | `14` ✔ | `e4` ✔ |
| 1 | **`04 00`** | **`db 06`** (no `14`) | `e4` ✔ |
| 2 | `04 01` | `14` ✔ | **`db 06`** (no `e4`) |

### A hypothesis was tested here and REFUTED — recorded because the wrong turn is the useful part

The batch table alone looked like a flow-control problem, and the first explanation written
here was that `LOOKAHEAD = 2` (`src/niimbot.js:961`) pushes all three pages back to back —
which it does: in a 3-page batch the guard `i - LOOKAHEAD >= 0` never fires, and page 1
started 3 ms after page 0 was buffered.

**The `copies` capture kills that explanation.** That path pipelines *nothing* — one upload,
one PageEnd, then pure waiting — and it still produced one label instead of three. There is
no send to lose a race, so timing cannot be the cause there. An explanation that covers one
capture and not the other is not the cause of either.

**What covers both: the D110 does one page per job.** `PrintStart pages=N` and
`SetPageSize copies=N` are both accepted and both ignored; the printer prints the first page
and considers the job finished. That is why the counter parks at 1, and why page 1's
PageStart answers `04 00` — the job is over, and what follows is refused with `0xdb`.

**CONFIRMED the same day.** Three single-label prints, three separate jobs, same connection:
three labels, each clean, each ~3.2 s, each with its own counter climbing 0 → 1
(`00 00 02 00` on the first poll of every job — so the counter **resets per job**, which the
fix depends on). Immediately after, the same tab ran `copies=3` again and again produced one
label. Multi-label on this printer means **N jobs, not one job of N pages** — a per-model
fact, now `pagesPerJob: 1` in `MODEL_IDS` (T-008).

The cost is inherent, not a choice: N jobs means the paper feeds out and retracts between
labels, so the "single job, pages pipelined, no retract between labels" behaviour that the
B1 Pro and M2-H get does not apply here. Slower, and correct. Measured on the D110: **~6 s
per label** through the split path against **~3 s** for a lone one, the difference being a
full job teardown and setup each time.

Independent confirmation that the labels were real, not just acked: the RFID `usedPaper`
counter went **59 → 62 → 65** across the two 3-label runs. That is the printer counting
consumed labels, on a different code path from the page counter the driver polls.

## Calibrating a print offset: print the parameter ON the label

The D110's `offset_y_px` was first derived arithmetically and it was **wrong**, in a way
worth keeping because the mistake is the ordinary one.

A ruler on a mis-registered print showed ~0.8 mm of blank above the content. At 203 dpi that
is 6.4 px, so `offset_y_px: -6` went in. A sweep on paper then said **-2**.

**What the arithmetic assumed and should not have:** that all 0.8 mm was *displacement*. The
likely reading — untested, so stated as a hypothesis — is that part of it is **physically
unprintable margin**: the head simply does not reach the first fraction of a millimetre of
the label. If so, 0.25 mm of correction is all there is to win, and the white that remains
has no software fix. Nobody has measured where the head actually starts reaching, so this
stays a hypothesis.

**The method that got the right answer, and generalises to any print-position parameter:**
print one label per candidate value, **with the value itself drawn on the label**. Six
labels came out reading `-2`, `-4`, `-6`, `-8`, `-10`, `-12`, and picking the good one was
looking at a table rather than remembering an order. A sweep beats a conversion because it
compares candidates against the physical edge instead of turning one measurement into a
number; and self-labelling beats sequencing because an interrupted or reordered run does not
poison the result.

The target that made it readable: a bar flush against **row 0** and another against the
**last row**, plus a frame inset 12 px. With a negative offset the top rows of the source are
what get cut, so the top bar *thins* as the value grows more negative and *disappears* once
it overshoots — an analogue readout of the very thing being tuned. The script lives in
scratch, not in the repo: it is a measuring instrument for one afternoon, not an artefact to
maintain.

**Neither failure is silent, and that is the design working.** Both were reported as
unconfirmed and threw; nothing claimed success. The disease of v1.3.3/v1.3.4 was a job that
reported 100 % over a blank label. Here the driver said "page 1 of 3" and refused to call it
done.

### The second defect, independent of all of the above

The driver asks PageStart a question and ignores the answer. `sendWait(0x03, [0x01], 0x04,
1000)` matches on the response **opcode** only (`receive()`, `src/niimbot.js:117`), so
`04 00` and `04 01` are indistinguishable to it. On page 1 the printer answered `00` and the
driver sent SetPageSize anyway, straight into the refusal. Every `sendWait` in the driver has
this blind spot; this is the first capture where a payload carried a "no".
