# Notes

Implementation notes, decisions and gotchas that do not belong in the README (which is
for users of the library) or in `protocol-v4.md` (which is the wire protocol).

## Consumable tags: what the RFID barcode actually is

Read from a B1 Pro on 2026-08-13, four rolls, via the demo's *Read status*:

| `barCode` | `serialNumber` | label | `capacity` | note |
|---|---|---|---|---|
| `11262111` | `PC0G229321004571` | 50 × 30 mm | 230 | 8 digits — **not** an EAN-13 |
| `6975746632324` | `PC0G428336001192` | 30×45+50 cable flag, **white** | 80 | EAN-13 ✔ |
| `6975746632331` | `PC0G513326003085` | 30×45+50 cable flag, colour not recorded | 80 | EAN-13 ✔ |
| `6975746632348` | `PC0G403350000212` | 30×45+50 cable flag, **red** | 80 | EAN-13 ✔ |

**`barCode` is the product code (GTIN), not a roll id.** The three 13-digit codes are
valid EAN-13 (check digit verified), and stripping the check digit leaves
`697574663232` / `…3233` / `…3234` — **consecutive**, on three rolls of identical
geometry differing only in colour. That is how a manufacturer numbers SKU variants; a
per-roll identifier would not come out consecutive on rolls bought separately.

`serialNumber` is what identifies the individual roll: it differs on every roll above and
carries what look like batch/date codes.

Two limits on that conclusion, both worth respecting:

- It is inference **from the format of the code**, not an observation. The direct
  confirmation — two physically different rolls of the SAME SKU showing the same
  `barCode` with different `serialNumber` — has **not** happened yet. An attempt on
  2026-08-13 produced two identical records (same `serialNumber`, same `usedPaper`),
  i.e. the same roll read twice, which confirms nothing.
- `11262111` is 8 digits and is not an EAN-13, so nothing here explains that scheme.
  Do not extend the conclusion to it.

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

## Pending: cable-flag sizes are documented but not in the registry

`T30*45+50` has verified-consistent numbers in `docs/protocol-v4.md:370`
(354 × 1122 px, stride 45 — 30 mm × 95 mm at 300 dpi) but **no entry in
`registry.json`**, so the demo cannot select it and the label memory has no size id to
point at. Note the protocol doc records a hardware-validated claim only for the B1
`T50*30` row; the cable-flag numbers are arithmetically consistent but not marked as
confirmed on paper.
