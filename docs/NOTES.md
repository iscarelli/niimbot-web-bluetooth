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

## Two contradictions about printhead width (unresolved)

`docs/protocol-v4.md` § *Label geometry* says to set `W` = **printhead width, not label
width**, and gives the B1 Pro's as **567 px**. Both halves conflict with what is
elsewhere in the repo:

1. The same table's cable-flag row uses `w_px` = **354** for `T30*45+50` — the **label**
   width (30 mm), not a printhead width. So the stated rule does not hold for labels
   narrower than the head, and nothing says where the boundary is.
2. `registry.json` uses **584** for the B1 Pro (`T50x30`) and attributes **567** to the
   **M2-H** (`T50x30_m2h`, with a `_note` saying so). The prose gives 567 to the B1 Pro.

Only one of 567/584 is the B1 Pro's real head width, and the difference decides whether a
full-width label silently loses its right edge — the failure would be invisible on the
50 × 30 rolls in use, which keep an unprinted right margin anyway.

**Cheap physical test:** print a page that is solid black across the full `w_px` at 584 on
a B1 Pro and look at the right edge. Clean edge ⇒ the head is ≥ 584. A strip missing on
the right ⇒ the head is 567 and `registry.json` is over-wide. Tracked on Vikunja.

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
