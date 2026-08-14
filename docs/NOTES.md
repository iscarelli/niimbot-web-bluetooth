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
