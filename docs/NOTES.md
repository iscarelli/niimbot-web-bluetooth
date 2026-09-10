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

### ✅ The confirmation happened — 2026-08-28, and on the 8-digit scheme

Six more rolls, read on a B1 Pro from a different machine, 15 days later:

| `barCode` | `serialNumber` | label |
|---|---|---|
| `10262260` | `PZ1I127313001006` | 50 × 30 mm, white |
| `02272333` | `PJ0H925674000155` | 25×38+40 cable flag, **yellow** |
| `02272334` | `PJ0H429776000139` | 25×38+40 cable flag, **green** |
| `6977031215465` | `PJ0H925732000311` | 25×38+40 cable flag, **blue** |
| `12222122` | `PC0H826395001478` | 25×38+40 cable flag, **white** |
| `6977031215458` | `PJ0H925729000578` | 25×38+40 cable flag, **red** |

🔥 **Row 1 closes the question this section had left open.** `10262260` also appears in
the 2026-08-13 table above, as a 50 × 30 white roll — with serial `PZ1G328306001390`.
The 2026-08-28 reading is `10262260` with serial **`PZ1I127313001006`**. Same barcode,
**different serial**, same product: two physically different rolls of one SKU. That is
exactly the direct confirmation the earlier text said had not happened, and the failed
2026-08-13 attempt (the same roll read twice) was looking for.

**And it lands on the 8-digit scheme, which was the undecoded one** — so "8 digits, meaning
unknown" no longer implies "possibly per-roll". At least this code generalises to the
product.

Two more corroborations in the same batch, both consistent with the GTIN reading:

- the blue `6977031215465` matches the 2026-08-13 blue exactly, and the new red
  `6977031215458` is the same maker prefix `6977031` with the **adjacent** product number
  (`21545` / `21546`) — the same variant-numbering already documented for maker `6975746`
  (`63232` white / `63233` yellow / `63234` red);
- the 8-digit yellow (`02272333`) and green (`02272334`) are likewise **consecutive**, so
  the 8-digit scheme numbers colour variants the same way. Read alone, without this
  section, consecutive numbers look like batch counters — they are not.

**What still is NOT established:** that *every* 8-digit code is per-product. One SKU
confirmed is one SKU confirmed. The operating rule below is unchanged and still does not
depend on the answer.

Two limits remain:

- Whether two 8-digit rolls of *different* dimensions relate at all is unestablished, and
  is **not assumed anywhere**. Note the two 50 × 30 rolls of the 2026-08-13 table carry
  *different* 8-digit codes (`11262111`, `10262260`) with serial prefixes `PC0G` and
  `PZ1G` — under the reading above they are two different white-ish 50 × 30 **products**,
  not the same product twice.
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

Asked upstream on 2026-09-09: [niimbluelib#28](https://github.com/MultiMote/niimbluelib/issues/28)
carries both captures and the open question, which is where the `chargeLevel` name and
offset came from. If the answer names a model where the byte is known to track the
battery, the A/B that settles it (charge full, capture, drain, capture) is worth running
here.

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
| `dc[03]` | `de` 10 b | `01 01 01 36 02 40 03 02 01 00` | **printhead width and capabilities** — see the `dc[03]` section below; `01 36` also appears as `40[09]` |

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

**The rest of the payload was named upstream on 2026-09-07** (MultiMote, niimbot-wiki
issue #3), and it resolves the "unexplained" marker this file carried for `dc[03]`:

    55 55 de 0a  VH VL  VH VL  WH WL  AC  HA  SR  SW  XX  aa aa
                 └hw─┘  └sw─┘  └width┘  │   │   │   └ supports write RFID
                                        │   │   └ supports RFID
                                        │   └ printhead alignment
                                        └ print accuracy

Against the two captures here, `AC HA SR SW` is `03 02 01 00` on **both** the M2-H and the
D11_H. So **`HA` does not scale with the head**: it is 2 on a 576 px head and 2 on a 144 px
one. Whatever "printhead alignment" counts, it is not a per-model difference between a
physical head and a printable width, and nothing here has established what it does count.
Two samples, both 300 dpi, both `03 02`, is not enough to guess from.

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

## B2 Pro bring-up: the first model where every guess held (2026-08-14)

Model id **6912** (`48: 1b 00`), advertised `B2 Pro-I304050285`, protocol 5, `v4` task,
300 dpi, printhead **576 px**. Captured on macOS/Chrome against the live GitHub Pages demo
(2.3.1) — the maintainer was remote, so `demo/serve.mjs` never ran.

**No code changed to bring it up.** Two paths already in the driver made it possible, and
both exist because someone previously argued they were dead weight:

- `connect()` falls back to `acceptAllDevices` when the model carries no `name_prefixes`
  (`src/niimbot.js:379` block) — so `await Niimbot.identify({})` from the console finds a
  printer the registry has never heard of. The demo's **Identify** button cannot: it filters
  the chooser to the union of known prefixes (`B1`, `D11`, `M2`, `D110`), and `B2 Pro-…`
  matches none of them.
- `assertSelection()` is a deliberate no-op when `printerInfo.task == null`, and
  `printImage()` takes `model`/`size` as plain objects. So a whole model can be tested from
  the console with invented `{ task, density, label_type, speed }` and `{ w_px, h_px }`,
  with no `registry.json` edit and nothing to revert if the guess is wrong.

**`dc[03]` said 576 before any label was spent**, third model in a row where it worked:

    M2-H     de:  01 01  01 36  [02 40 = 576]  03 02 01 00
    D11_H    de:  04 01  04 1c  [00 90 = 144]  03 02 01 00
    B2 Pro   de:  02 01  02 0b  [02 40 = 576]  03 02 01 00

This also confirms on a third model that `de`'s first two fields just repeat `40[0c]`
(hardware version, `02 01`) and `40[09]` (software, `02 0b` = 2.11) — previously seen twice,
now three times.

### 300 dpi was established with no ruler, using the label as the reference

The obvious test — print N rows, measure the millimetres — needs an instrument the remote
tester may not have, and an eyeballed "about 20 % of the label" is not evidence: 100 rows is
28 % of a 30 mm label at 300 dpi and 42 % at 203, and nobody eyeballs the difference
reliably.

What worked: **print a block 354 px tall — exactly 30 mm _if_ the printer is 300 dpi — onto
a 50 × 30 label.** The label itself becomes the measuring stick, and the two hypotheses
predict visibly different pictures:

| | 300 dpi | 203 dpi |
|---|---|---|
| block height | fills the label exactly | 44 mm — overruns onto the gap and the next label |
| white margin right of a 354 px block | ≈ 20 mm | ≈ 6 mm |

Result: filled the height exactly, ~40 % white to the right. Both signals agreed, and neither
needed a measurement — only a comparison. **Generalises: to identify a resolution remotely,
send the dimension the hypothesis predicts and let the consumable adjudicate.**

(Worth recording that the B2 Pro is *sold* as 300 dpi and that turned out to be right. An
earlier turn in this session cited the D110 as a case where the datasheet said 300 and the
ruler said 203 — that is **not what happened**. The D110's `dpi: 203` was measured, and the
"300 dpi would have been 50 mm" in its `MODEL_IDS` comment is the arithmetic showing the
measurement discriminates, not a belief anyone held. The D110's real surprises were the
`task` (`b1`, not `v4`) and `pagesPerJob: 1`.)

### Multi-page works — and this is the first model where it was checked before shipping

`copies: 3` printed **three** labels, with the printer's own counter stepping `page 1` →
`page 2` → `page 3` and `PrintEnd` acked (`f3` → `f4`). So no `pagesPerJob` entry, and that
absence is now MEASURED rather than assumed — which is the whole difference from the D110,
where the same call acked cleanly, counted to 1, and printed one label.

All three test prints ended `done (PrintEnd acked)`. Nothing went through the unconfirmed
path.

**The B2 Pro emits `0xD3` too.** The D110 note above says "whether the other models emit it
has not been checked". Checked now: for a 354-row page the printer volunteered `d3: 00 c7 01`
(199) and `d3: 01 61 01` (353) unasked — a row-received count from the far side of the radio,
matching what was sent. Two models out of two that were looked for it. Still nothing reads
it; `lastUnsolicited` takes it and drops it.

### What is NOT measured on the B2 Pro

- **`paced` vs unpaced.** The print ran `paced` because the tester is on macOS (`IS_MAC`,
  `src/niimbot.js:107`), not because pacing was shown necessary. Unpaced was never tried.
  Same standing as the D110 entry.
- **`bundle`.** Never tried; conservative `false`.
- **Whether 576 is really the clip point.** The head printed edge to edge on a 50 mm label,
  which is exactly the observation that was too strong on the M2-H (584 "reached the edge",
  `dc[03]` said 576, and 8 px = 0.68 mm hides in a border). Here `dc[03]` agrees, so the two
  sources concur — but the print did not independently confirm the number.

## N1: the first printer here that is not a table row (2026-08-14)

Model id **3586** (`48: 0e 02`), advertised `N1-H324110115`, firmware 4.07, **`b1` task,
203 dpi** — both measured, see below. Three divergences, any one of which the current code
gets wrong:

**1. `0xA5` answers with opcode `0xB4`, not `0xB5`** — payload `00 96`. `detectPrinter()`
(`src/niimbot.js:344`) waits on `0xb5`, so it burns its 1 s timeout and reports
`protocolVersion: null`. This is *not* the D110 case: the D110 answers `0xb5` with too few
bytes, so the length guard covers it. Here the opcode itself is different, and the reply is
dropped as unsolicited.

**2. `dc[03]` and `dc[04]` are both refused** — each answers cmd `0x00`, payload `01`. So
there is **no printhead-width report** (the trick that saved labels on the D11_H and the
B2 Pro is unavailable here) and **no heartbeat in that form**, which means `getStatus()` and
`readiness()` have nothing to decode and `b1Handshake()` burns another second waiting.

**3. `write=false writeNoResp=true`** — the characteristic has **no acked write path at
all**. Every other model here reports both `true`. `WRITE_MODE="acked"` on this printer is
not "slower but safer", it throws. `writeRaw()`'s error text (`src/niimbot.js:228`) names the
opposite failure — "this characteristic has no unacked write path" — and would be misleading
here.

What does work: `40[0b]` (serial, ASCII `H324110115`), `40[0d]` (MAC, `ca e6 9e 11 03 24`),
and the RFID read `0x1a[01]` → `0x1b` (barcode `04232207`, 150 labels total, 4 used).

**One coincidence, deliberately not promoted to a fact:** the `0xB4` payload `00 96` is 150,
the same as the roll's total-label count from the RFID. It may be that `0xA5` means something
else entirely on this family, or it may be chance on one capture. One observation is not a
decoding.

### The task: `b1`, and the wrong guess cost exactly one label

Driven as `v4` the N1 reproduced the D110's refusal signature command for command: `0x21→0x31`,
`0x23→0x33` and `PrintStart 9b 0x01→0x02` all acked, then the 13-byte `SetPageSize` and
`PageEnd` each drew a `0xdb 06` and nothing else. Driven as `b1` — `PrintStart` 7b,
`PageStart 0x03→0x04`, `SetPageSize` 6b `0x13→0x14` — every command acked, the page counter
reached 1 at 100 %/100 %, and `PrintEnd 0xf3→0xf4` closed it. The driver refused to claim the
failed `v4` run had printed, which is the design working.

Two things worth carrying forward. **`0xdb 06` is now a two-model signature**, not a D110
quirk — it is the reliable tell for "right framing, wrong task". And **the `b1Handshake` only
runs when `connect()` is called with a `task: "b1"` model**, while `connect()` returns early
if a link is already open; so a console test that identifies first and prints second silently
skips the handshake. Every N1 test therefore had to start with `disconnect()`.

### 203 dpi — measured, and it contradicts the spec sheet

**The N1 is sold as 300 dpi. It measures 203.** That is not a rounding argument: at 300 dpi a
pixel is 0.085 mm and at 203 it is 0.125 mm, a factor of 1.46 on every dimension.

Getting there took four labels, and three of them were wasted on tests that could not
distinguish the hypotheses. Recording the dead ends, because the shape of the mistake repeats:

1. **591 rows solid black** (50 mm at 300 dpi) → the whole label came out black. Useless:
   true under both hypotheses, since at 203 dpi the first 400 rows already fill the label.
2. **591 rows, bar in the last 60** → label blank, bar nowhere. This *looks* decisive and is
   not. It says the bar fell outside the printable area, which 203 dpi explains (rows > 400
   are discarded) but so does *300 dpi with a printable area shorter than 50 mm* — and this
   project's own notes warn that `h_px` is the printable area, not the label pitch (see
   *Cable flags*, above). An argument from absence has two causes here, not one.
3. **The test that worked: print a numbered ruler and let the printer truncate it.** Ticks
   every 50 rows, each labelled with its row number. The last one printed was **350**, and it
   landed ~45 mm down a 50 mm label → **~7.8 px/mm**, against 7.99 for 203 dpi. At 300 dpi row
   350 would sit 29.6 mm down, leaving ~20 mm of blank label — not a judgement call.

**The rule: an absent mark has more than one cause, a present mark at a predicted position has
one.** Tests 1 and 2 asked "did it fit?"; test 3 asked "where did it land?", and only the
second kind of question discriminates. This is the same *print the parameter on the label*
technique that settled the D110's offset sweep, and it is the third time it has been the thing
that worked.

### The printhead is 96 px — pinned by two methods that bound it from opposite sides

**First bound, free, from the ruler print's own failure.** Three-digit labels came out as two
digits (`100` → `10`, `350` → `35`) while the two-digit `50` survived. The text starts at
x = 62 and each bold 30 px digit is ~17 px, so two digits end near 96 and three near 113. The
`50` surviving puts the head at **≥ ~96**.

**Second bound, one label.** Five stacked bands of increasing width — 80, 96, 104, 112, 120 px
— each labelled with its own width. Result: **everything from 96 up came out identical, and 80
came out narrower.** Identical bands are both clipped, so the head is **≤ 96**; the narrower 80
puts it **> 80**.

The two intervals meet at exactly **96**, which is also a multiple of 8 — the stride alignment,
and the same reasoning that fixed the D110's head at 96 ("the only multiple of 8 within a
millimetre of the reading"). So the N1 and the D110 have the same printhead, which is what two
203 dpi small-label units of the same generation ought to have.

**Why two bounds and not one measurement.** A single reading of "how wide did the black come
out" converts a ruler into a number and hides its own error. Bounding from both sides does not:
the `50` surviving and the 96-band clipping are different observations that cannot both be
wrong in the same direction. The D110's own `_note` records the cost of the one-reading
approach — an offset of −6 that a six-candidate sweep later corrected to −2.

**Consequence for the size entry.** A 14 mm label at 203 dpi is 112 px, but the head is 96, so
`w_px: 96` — ~1 mm unprinted on each side, and that is the printer, not a choice. Note that
this makes the N1's `T14x50` geometrically identical to the D110's `T15x50` (96 × 400). They
are still separate entries: `T15x50` carries `offset_y_px: -2`, measured on a D110 by a
six-label sweep, and nobody has measured paper registration on an N1.

### `pagesPerJob: 1` — measured, and it stops being a D110 anecdote

`copies: 3` at the real 96 × 400 geometry printed **one** label. The interesting part is what
the printer agreed to first: `SetPageSize` went out as `13 (6b) 01 90 00 60 00 03` — 400 rows,
96 px, **three copies** — and was acked with `14`; then `d3: 01 8f 01` reported **399**, so all
400 rows arrived. Nothing was lost on the radio and the task was not wrong. The printer
accepted a three-copy job, received it whole, printed one label, and parked its counter at
`page 1 / 100 % / 100 %` until `PAGE_WAIT_MS` (25 s) gave up and the driver threw.

That is the D110's failure reproduced field for field, on a second model — same `b1` task,
same 203 dpi, same 96 px head, same small-label family. So the split-into-N-jobs path written
for the D110 covers the N1 unchanged.

**What this does NOT license.** Two models sharing a defect is a pattern, not a rule, and
`pagesPerJob` stays per-MODEL and measured one at a time — the `CLAUDE.md` constraint exists
because assuming a task family behaves alike broke the B1 Pro in v1.3.3 and then cost a second
time on the D110. The useful lesson is cheaper than a rule: **the N1's cap was found because
someone spent three labels asking, rather than reasoning that "3 copies obviously works".** It
is three labels against a defect that reports 100 % and hands you one label.

### `offset_y_px: -1` — and the sweep answered a second question nobody asked it

The first real print at the shipped 96 × 400 geometry came out clipped at the BOTTOM. Two
causes fit that symptom and the paper cannot tell them apart: either the printable area is
shorter than 400 rows (so `h_px` is too big), or the print starts late and the content is
pushed off the end (so it wants a negative `offset_y_px`).

The six-candidate sweep from *Calibrating a print offset* separates them, and the separation
is built into the target rather than into the reading: a bar flush against row 0, a bar flush
against the last row, a frame inset 12 px, and the candidate value printed large in the
middle. **If some label shows both bars, it is registration. If none does — the top bar
thinning away as the bottom bar arrives — the loss is only changing ends, and the printable
area is genuinely short.**

`-2` came out best **of those six**, which settles it as registration — but not as the final
value, and the difference cost a round. The grid held no odd numbers, so what the sweep
returned was the best available *candidate*. Printing at `-2` through the demo still showed
the bottom line only partly landing; comparing the odd neighbours put it at **`-1`**, which
is what ships.

**The lesson is about the grid, not the value.** A sweep answers only what it was asked, and
a sweep of even numbers cannot return an odd one. Nothing in the reading rule was wrong —
"the label with both bars wins" held throughout — it just had no `-1` to choose. When a sweep
lands on a value adjacent to the edge of its own resolution, the resolution is the next thing
to question.

Worth recording that `-1` is **not** the D110's `-2`. `T15x50`'s note and T-015 both forbade
copying that value, and that prohibition is what made someone measure instead of assume — the
two entries are geometrically identical (96 × 400) and would have looked safe to unify.

**The unasked question it also answered: the dpi, exactly.** A 400-row page fitting a 50 mm
label with 1 row of correction means the printable area IS 400 rows over 50 mm — **8.0 px/mm,
dead on 203 dpi**. The ruler print had put it at ~7.8 px/mm from a "5 mm short of the edge"
eyeball; this lands on the nominal value from a completely different measurement, with no
estimation in it. Two independent routes, and the spec sheet's 300 dpi is out by 46 %.

## The B1 Pro reports a 576 px head, and `T50x30` sends 584 (2026-09-07)

`await Niimbot.probe(0xdc, [0x03])` on a **B1 Pro (model id 4097)** answers **576**. The
reading was taken on a Windows host, `writeMode=fast`, driver 2.4.0, and it spends no label.

**`T50x30` in `registry.json` has `w_px: 584`.** The driver sends `w_px` as `W` in
SetPageSize, the printer prints columns `0 … W-1`, and anything past the head is dropped with
no error at any layer. If 576 is the head, the rightmost **8 px = 0.68 mm** of every B1 Pro
label has never printed.

This is the M2-H story again, on the printer the M2-H story was originally reasoned from.
T-020 withdrew the claim that the M2-H head "reaches at least 584" — the claim rested on
solid black printing edge to edge at 584, and `dc[03]` answered 576, with the note that 8 px
is inside what "it reached the edge" can hide. The same argument applies here, and now the
B1 Pro has answered for itself.

**Where the number came from — and the reasoning was wrong, see the correction below.**
576 was *predicted* rather than read off this printer first. The community wiki's model
table is generated from NIIMBOT's cloud catalog by `fill_info_from_cloud.py`, which converts
a millimetre width with `{"203": 8, "300": 11.81}` px/mm, and 48 mm x 12 = 576 reproduced
the reported head on the B2 Pro, M2-H and D11_H. So the guess was that the constant should
be 12. The prediction held on the B1 Pro, and **the reasoning behind it was still wrong**:
11.81 is correct and the head width is not a millimetre figure times anything. Measured with
a caliper on 2026-09-07 and refuted upstream on a B21 Pro the same day. See
*Neither constant derives a printhead* below, and
https://github.com/MultiMote/niimbot-wiki/issues/3

**What is NOT established.** That 584 is wrong on paper. The printer reporting 576 and the
driver silently dropping columns past the head are both documented behaviour, but the
discriminating print — solid black at `w_px` 584 versus at 576 on a B1 Pro, compared for
width — has not been run. That is the same test that settled the D11_H (177 versus 144 came
out identical), and it is the maintainer's step. Until then 576 is *reported*, not
*confirmed on paper*, which is the exact wording T-020 chose for the M2-H and for the same
reason.

### Confirmed on paper the same day (2026-09-07)

The discriminating print was run on the B1 Pro, and it was not the solid-black comparison
this section originally called for. Two solid blacks differ by 0.68 mm, which is the width
T-020 already recorded as hiding inside "it reached the edge"; the test asks you to *measure*
rather than to *read*.

What was printed instead, declaring `w_px` 584 so the columns past the head are actually
sent: a solid block at columns 0-47 (a control that the label printed at all), a full-height
reference bar at 540-543 (a column the head certainly reaches), and **four 4 px steps at
columns 568, 572, 576 and 580, each in its own vertical quarter** so they are told apart by
position on the feed axis rather than by measuring across it. Two steps fall inside 576 and
two fall past it, so a single flawed step cannot be mistaken for the result.

**On paper: the control block, the reference bar, and only the top two steps.** The steps at
576 and 580 are absent.

So columns 0-575 print and column 576 does not. The printable width is **exactly 576** — a
value, not a bound — and it agrees with `probe(0xdc,[0x03])` to the pixel. `T50x30`'s 584
therefore loses columns 576-583, which is 8 px and 0.68 mm, silently, on every 50 x 30 label
ever printed on a B1 Pro here. T-023 stands.

**Why this design generalises.** The D11_H was settled by comparing two solid blacks because
there the difference was 33 px (2.8 mm) and visible across the room. That test does not
transfer to an 8 px difference, and reaching for it anyway is how a question that has a
readable answer gets turned into a measurement nobody trusts. Numbering or positioning the
candidates inside the image — the same move as the row-numbered ruler that settled the N1's
dpi — turns "is it wider?" into "which marks are there?", and the second question has one
answer.

### The 203 dpi side confirmed too: the B1 reports 384 (2026-09-07)

`probe(0xdc,[0x03])` on a **B1 (model id 4096)** answers **384**, which is 48 mm x 8 px/mm
and exactly what the constant predicted. This is the row of `ppmm_dict` that was already
correct upstream and that the proposed fix does **not** touch, so it is the control: a fix
that moved this number would have been the wrong fix.

Both dpi classes are now sourced from hardware rather than from a catalog:

| class | model | reported head | on paper |
|---|---|---|---|
| 203 dpi | B1 | 384 | not run |
| 203 dpi | D110, N1 | refused | 96 |
| 300 dpi | B1 Pro | 576 | 576 exactly |
| 300 dpi | B2 Pro | 576 | edge to edge at 576 |
| 300 dpi | M2-H | 576 | not run |
| 300 dpi | D11_H | 144 | 144 |

(An earlier version of this table headed the first column "px/mm" and put 12 in it. The
scale is 11.81; see *Neither constant derives a printhead*.)

**And `T50x30_b1` needs nothing.** Its `w_px` is 384, which is the head to the pixel, so the
B1 has never lost a column. The B1 Pro is the only shipped size that overruns its head, which
is what T-023 fixes.

### Third `de` sample: the B1 Pro, and `HA` is constant (2026-09-07)

    M2-H     de:  01 01  01 36  [02 40 = 576]  03 02 01 00
    D11_H    de:  04 01  04 1c  [00 90 = 144]  03 02 01 00
    B1 Pro   de:  02 01  02 0c  [02 40 = 576]  03 02 01 00

Named against the layout MultiMote published on 2026-09-07: hardware version, software
version, printhead width, then `AC` print accuracy, `HA` printhead alignment, `SR` supports
RFID, `SW` supports write RFID.

**`HA` is `02` on all three**, across head widths of 576, 144 and 576. So it does not encode
a difference between a physical head and a printable window: such a value would have to vary
per model, and 584 - 576 = 8 is not 2 on any reading. That does not *refute* the window
hypothesis — a window sitting 2 dots in would still leave source columns 576-583 outside a
576-wide window, which is what the staircase saw — but it removes `HA` as the evidence for
it. A field that is constant across every sample you have tells you almost nothing.

**`AC` is `03` on all three, and all three are 300 dpi.** That is a hypothesis with a free
test: if `AC` encodes print accuracy in the sense the catalog means, then a **203 dpi**
printer should not answer `03`. The B1 (model id 4096, head 384) has never been dumped. If
it answers something other than `03`, `AC` is the dpi and a driver can stop trusting a
catalog for that too; if it still answers `03`, `AC` means something else and this guess
dies. Either way it costs no label:

    const r = await Niimbot.probe(0xdc, [0x03]);
    console.log([...r.data].map(b => b.toString(16).padStart(2, "0")).join(" "));

**Not a coincidence worth chasing yet:** the high byte of the hardware version and of the
software version agree within each model (`01`/`01` on the M2-H, `02`/`02` on the B1 Pro,
`04`/`04` on the D11_H). Three samples, and nothing depends on it.

### `AC` is the dpi class — the B1 answered `02` (2026-09-07)

The fourth `de` sample, and it was taken to kill a guess rather than to confirm one.

    M2-H     de:  01 01  01 36  [02 40 = 576]  03  02 01 00
    D11_H    de:  04 01  04 1c  [00 90 = 144]  03  02 01 00
    B1 Pro   de:  02 01  02 0c  [02 40 = 576]  03  02 01 00
    B1       de:  03 01  03 08  [01 80 = 384]  02  02 01 00
                                               ^^ AC

The first three are 300 dpi and all answer `AC = 03`. The B1 is **203 dpi and answers
`02`**. That was the prediction written down before the reading: a field called "print
accuracy" that never varies is not print accuracy. It varied exactly where it had to.

**So the printer reports its own dpi class**, and the two known values line up with the two
px/mm constants at every head width measured here:

| model | `AC` | head | catalog mm | head ÷ mm |
|---|---|---|---|---|
| B1 | `02` | 384 | 48 | **8.0** |
| B1 Pro | `03` | 576 | 48 | **12.0** |
| B2 Pro | `03` | 576 | 48 | **12.0** |
| M2-H | `03` | 576 | 48 | **12.0** |
| D11_H | `03` | 144 | 12 | **12.0** |

`AC 02` is the 203 dpi class and `AC 03` the 300 dpi class. Whether `AC` is an index or
something like dpi/100 cannot be told from two values. **The `head / mm` column is
arithmetic on the catalog's millimetre figure, not a measured scale** — the scale is
11.81 px/mm, measured with a caliper, and that column landing on 12.0 is a property of which
printers happen to sit on this shelf. See *Neither constant derives a printhead*.

**What this is good for.** Geometry no longer needs a catalog at all on a printer that
answers `0xDC[0x03]`: the width comes from bytes 4-5 and the scale from `AC`, both from the
device. That is the same argument this project already makes for `w_px` — ask the printer
instead of deriving — now extended to the dpi.

**And `HA` is dead as a lead.** It is `02` on all four samples, spanning heads of 384, 576,
576 and 144 and both dpi classes. A field constant across every sample carries no per-model
information, so it is not the head-versus-window difference the 584 question was looking
for. That question stays open and stays unanswerable from here.

**Still not established:** anything about the models nobody here owns. Two `AC` values are
two data points; a 600 dpi model, if one exists, would say whether `AC` is an index or an
arithmetic encoding.

### Open: 576 dots, or a 576-wide window inside a 584-dot head? (2026-09-07)

The maintainer raised this straight after the staircase print, and he is right that **the
test above does not discriminate**. Blank columns at 576-583 are explained equally well by:

- **(a)** the head has 576 dots, or
- **(b)** the head has 584 dots and a 576-wide printable window sits at offset 0, leaving
  the last 8 dots addressable but outside the window.

Nothing printed here separates them. What the staircase establishes is the **printable
width**, which is 576 either way, and that is the only one of the two the driver can act on:
there is no known command to move the window, so columns past 575 do not come out. T-023 is
unaffected by which explanation is true.

**Where the intuition comes from is worth writing down, because two real things in this file
point that way and neither says what it seems to.**

- The M2-H sends **567** while its head reports **576**, and that gap is deliberate: the
  M2-H is thermal transfer, the ribbon drifts, and 567 is a ~1.4 mm right margin that
  absorbs it. So a head/used-width gap does exist on a Niimbot here — but it goes the other
  way. A margin sends **fewer** pixels than the head. 584 sends **more**. The M2-H reasoning
  cannot justify 584 in either direction of the argument.
- This file *did* once say the M2-H head "reaches at least 584", from solid black printing
  edge to edge at that width. T-020 withdrew it: 8 px is 0.68 mm and hides inside "it
  reached the edge". A retracted claim is exactly the kind of thing that stays in memory
  after the retraction does not.

**The one mechanism we control was already tested, and it is excluded.** To detect dots
beyond 576 you would have to *move* the window, and the only parameter a caller controls is
`W`. The staircase print already contains that experiment. It declared `W = 584` and put
steps at columns 568, 572, 576 and 580; two came out and two did not. Work out what each
positioning rule predicts for a 576-wide window inside `W = 584`:

| rule | window offset | steps that would print | matches paper? |
|---|---|---|---|
| origin fixed at dot 0 | 0 | 568, 572 | **yes** |
| window centred on `W` | -4 | 568, 572, 576 | no |
| window right-aligned in `W` | -8 | 568, 572, 576, 580 | no |

Only the fixed origin survives. **`W` does not move anything; it only clips.** So there is
no lever here: no command is known that writes `HA`, and sweeping top-level opcodes to look
for one is the thing this project refuses to do, because this protocol has commands that
print, feed, write RFID and update firmware.

**A second reported width exists, and it was asked for.** The community wiki's `PrinterInfo`
table lists two sub-codes this project had never read: `0x40[0x04]` **PrinterHeadWidth**
(response `0x44`, 2 bytes) and `0x40[0x05]` **PrintingAccuracy** (`0x45`, 1 byte), both
annotated there as "doesn't seem to be used in firmware". A second reported head width would
have settled the question outright: 584 from one source and 576 from the other is exactly
what a physical head and a printable window would look like.

Both were probed on a **B1 Pro** on 2026-09-07. Both answer **cmd `0x00`, data `01`**, this
protocol's "not supported". The M2-H sweep implies the same for that model, since `40[04]`
never appears among the sub-codes that answered. So the field is documented and unimplemented
on both printers here, which corroborates the wiki's own note.

That closes the question as far as it can be closed from the driver. The physical dot count
stays **unknown**, and it stays unknown for a stated reason rather than for lack of trying:
every addressable path lands on the same 576 columns at the same origin, and the one command
that would have reported a different number refuses to answer.

🔥 **The correction that had to be made here is about a claim, not a number.** The paragraph
above originally ended at "for lack of trying" without the `40[04]` probe behind it, and the
basis for it was that this repo's own protocol notes document no such command. That is
coverage of *this documentation*, not of the printer. The sweep those notes rest on was run
on **one model**, the M2-H, and the sub-code space of the B1 Pro had never been touched. The
maintainer asked whether the claim had been researched or assumed. It had been assumed, and
the answer only became true after ten minutes of reading someone else's protocol page and one
free probe. **Before writing that something does not exist, check whose map you are reading.**

**What would still settle it, and none of it is available here.**

- A command that writes `HA`, if one exists. Nobody here will find it by sweeping.
- The official app doing something the protocol notes have not captured, seen in a sniff.
- Teardown photos or a datasheet for the head module itself.
- A model where `40[04]` *is* implemented, which would let the two reported widths be
  compared on the same printer.

(`HA` was checked and is `02` on all four printers dumped here, across heads of 384, 576,
576 and 144, so it carries no per-model information either way.)

Until one of those is run, the physical dot count is **unknown** and this file should not
say otherwise.

## Neither constant derives a printhead — 11.81 measured, and the whole approach was wrong (2026-09-07)

Two things collapsed within an hour of each other, and the second one is the useful one.

**First, upstream refuted the constant.** MultiMote tested on a **B21 Pro**: 591 px (the
current wiki value) clipped, 600 px (what a factor of 12 would produce) clipped worse, and
**576 px — the value from `0xde` — fit**. That printer's catalog `widthSetEnd` is **50 mm**
while the B1 Pro's is **48 mm**, and both report a **576** px head. Same head, different
millimetre figure. No function of `widthSetEnd` returns 576 for both, so no constant fixes
that table: not 11.81, not 12, not anything.

**Then the ruler print settled the scale, against me.** On a B1 Pro, measured with a
**caliper**:

| span | px | measured | 11.81 px/mm predicts | 12 px/mm predicts |
|---|---|---|---|---|
| tick 0 to tick 45 | 540 | **45.7 mm** | **45.72** | 45.0 |
| the two full-height lines, inner edge to inner edge | 572 | **48.4 mm** | **48.43** | 47.67 |

Both land on 11.81 within 0.03 mm, and both miss 12 by more than 0.7 mm — fourteen times a
caliper's resolution. **These printers are really 300 dpi.** The catalog's 11.81 was right
the whole time.

**So why is the head 576 and not 567?** Because a printhead is a dot count, not a converted
millimetre figure. 576 dots at 300 dpi is 48.77 mm, and the catalog's nominal 48 mm converts
to 566.9. The dot counts seen here are 96, 144, 384 and 576 — every one a multiple of 8,
which is what a row buffer packed one bit per pixel would produce. `widthSetEnd` is a
nominal figure that sometimes coincides with the head (the D110's 12 mm) and sometimes does
not (the B21 Pro's 50 mm), with nothing in the data marking which case you are in.

🔥 **What actually went wrong here, and it is not the arithmetic.** Every printer on this
shelf has a `widthSetEnd` equal to its printhead width in millimetres. Four models agreeing
looked like a law; it was a property of the sample. The B1 Pro "prediction" felt like a
falsification test and was not one: it could only ever confirm, because it came from the
same population the rule was fitted to. A test that cannot fail is not a test, and I called
one a prediction in public before a printer I do not own took one print to break it.

**What survives.** The `AC` field is the dpi class, predicted before it was read and
confirmed on a printer of the other class. The measured head widths stand. And the
recommendation that came out of the wreck is the one this project already applies to
`w_px`: **ask the printer, do not derive** — `0xde` bytes 4-5 for the head, `AC` for the
scale, and leave the cell empty rather than plausible when neither is available.

**T-023 is untouched by all of this.** It rests on the staircase print, where columns 576-583
did not come out on a B1 Pro. That is a direct observation about which columns print, and it
does not depend on px/mm or on any catalog field.

### The margins close the model, and refute 12 px/mm a third time (2026-09-07)

Same label, same caliper, measuring what the print does **not** cover rather than what it does:

    label width          50.0 mm
    margin, column 0 side   0.7 mm
    margin, column 575 side 0.5 mm

The two margins sum to **1.2 mm**. A 576 px band at 11.811 px/mm is 48.768 mm, so on a 50 mm
label the prediction is **1.232 mm**. It agrees to 0.03 mm.

This is worth more than another decimal place on the same number, because it measures the
**complement**. The band and its margins fail in opposite directions, so an error that
flattered one would spoil the other. At 12 px/mm the band would be 48.00 mm and the margins
would have to sum to **2.0 mm**; they measure 1.2. That is 0.8 mm out, on a third
independent quantity, with an instrument that resolves 0.05.

**The band is centred, within what a single label can show.** The two margins differ by
0.2 mm, which is 2.4 px, so the band's centre sits about 0.1 mm off the label's. That is
inside the play of a roll sitting in its guides, and one label cannot separate a systematic
offset from how this particular label was loaded. Calling it centred is the honest reading;
claiming a 2.4 px bias would need the same measurement across several labels, checking
whether the same side stays wider.

**No horizontal offset correction is warranted**, and the registry has nowhere to put one
anyway: `offset_y_px` is the feed axis and there is no X equivalent.

🔥 **And it settles what the 8 lost columns are lost to.** At `w_px` 584 the band would be
49.45 mm, leaving 0.55 mm of margin: still comfortably on a 50 mm label. So columns 576-583
are not falling off the paper. They are past the printhead, which is what the staircase print
showed directly and what T-023 fixes. Paper was never the constraint.
