/* Niimbot label geometry — millimetres to the pixel numbers SetPageSize wants.
 *
 * OPTIONAL and separate from src/niimbot.js for the same reason as label-memory.js: the
 * driver takes sizes from the caller and does not compute them. Pure arithmetic, no DOM,
 * no storage — which is what lets it be tested in Node with no browser and no printer.
 *
 *     <script src="label-size.js"></script>
 *     NiimbotLabelSize.sizeFromMm({ w_mm: 30, h_mm: 95, dpi: 300, printhead_px: 584 })
 *     // → { w_px: 354, h_px: 1122, stride: 45, clamped: false }
 *
 * THE CLAMP, and why it is min() rather than a flat rule. docs/protocol-v4.md says to
 * set W = the printhead width, "not the label width" — but the repo contains both
 * cases: registry.json uses the printhead width for a 50 mm label (584 px on the B1
 * Pro, the label itself being ~591 px, so the head is the limit), while
 * docs/protocol-v4.md:370 uses the LABEL width for a 30 mm cable flag (354 px, well
 * inside the head). min() is the only rule both data points satisfy: print the label
 * width, unless the head is narrower, in which case the head is all you get.
 *
 * `printhead_px` is a PARAMETER, never a constant in here. Which value is right for the
 * B1 Pro is genuinely unresolved — docs/protocol-v4.md says 567, registry.json uses 584
 * (see docs/NOTES.md § Two contradictions about printhead width). Hardcoding either
 * would bake an open question into shipped code.
 *
 * `clamped` is returned so the caller can SAY it clamped. A silent clamp is how a label
 * quietly loses its right edge: the printer prints columns 0…W-1 and drops the rest.
 */
(function (root) {
  "use strict";

  var MM_PER_INCH = 25.4;

  function positive(n) {
    return typeof n === "number" && isFinite(n) && n > 0;
  }

  // Returns null for unusable input — never a size object with NaN in it, which would
  // reach the printer as a page-size command and waste a label to find out.
  function sizeFromMm(spec) {
    spec = spec || {};
    var w_mm = spec.w_mm, h_mm = spec.h_mm, dpi = spec.dpi, head = spec.printhead_px;
    if (!positive(w_mm) || !positive(h_mm) || !positive(dpi)) return null;
    if (head != null && !positive(head)) return null;

    var pxPerMm = dpi / MM_PER_INCH;
    var label_px = Math.round(w_mm * pxPerMm);
    var h_px = Math.round(h_mm * pxPerMm);

    var clamped = head != null && label_px > head;
    var w_px = clamped ? Math.round(head) : label_px;
    if (!positive(w_px) || !positive(h_px)) return null;

    return {
      w_px: w_px,
      h_px: h_px,
      stride: Math.ceil(w_px / 8),
      clamped: clamped,
      label_px: label_px,          // what the label alone would have needed
    };
  }

  // Convenience for building a registry-shaped entry from a measurement, so what an app
  // exports can be pasted into registry.json without hand-editing the key names.
  function registryEntry(spec) {
    var geom = sizeFromMm(spec);
    if (!geom) return null;
    return {
      label: spec.label || (spec.w_mm + " × " + spec.h_mm + " mm"),
      w_mm: spec.w_mm,
      h_mm: spec.h_mm,
      w_px: geom.w_px,
      h_px: geom.h_px,
      dpi: spec.dpi,
    };
  }

  root.NiimbotLabelSize = {
    sizeFromMm: sizeFromMm,
    registryEntry: registryEntry,
    VERSION: "1.0.0",
  };
})(typeof window !== "undefined" ? window : globalThis);
