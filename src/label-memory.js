/* Niimbot label memory — remembers which label a consumable roll holds.
 *
 * OPTIONAL and deliberately separate from src/niimbot.js. The driver reads no config
 * and owns no UI: it takes the model and the size from the caller. This file is the
 * opposite — it is pure application state — so it ships as its own <script> and you
 * load it only if you want it:
 *
 *     <script src="niimbot.js"></script>
 *     <script src="label-memory.js"></script>   <!-- optional -->
 *
 * It never references `Niimbot`, so load order does not matter and either can be used
 * without the other.
 *
 * WHY IT EXISTS. The RFID tag identifies the consumable (`barCode`) but carries no
 * dimensions and no colour — the payload is fully accounted for by
 * uuid · barCode · serial · printLimit · usedPaper · consumablesType · capacity
 * (src/niimbot.js:464-465), with no spare bytes. The official app looks the dimensions
 * up on Niimbot's server. Rather than curate a table that can only cover rolls we have
 * seen, an app LEARNS: whatever the user actually printed with on a barcode is what
 * gets restored the next time that roll shows up.
 *
 * On `barCode`: the 13-digit codes observed so far are valid EAN-13, i.e. PRODUCT codes
 * (see docs/NOTES.md), so a barcode→record table is in principle shareable between
 * users rather than personal. `serialNumber` is what identifies the individual roll.
 */
(function (root) {
  "use strict";

  // A stored value is a RECORD, not a bare size id: colour, like size, is application
  // data the tag does not carry, and a string has nowhere to put it. Older data IS a
  // bare string, so it is normalised on READ and never rewritten in bulk — a
  // migrate-everything pass can only lose more than it fixes.
  function normalize(v) {
    if (typeof v === "string") return v ? { size: v } : null;
    if (v && typeof v === "object" && !Array.isArray(v) && typeof v.size === "string" && v.size) return v;
    return null;
  }

  // `remember(bc, "T50x30")` stays valid as shorthand for `{ size: "T50x30" }`.
  function toRecord(v) {
    if (typeof v === "string") return v ? { size: v } : null;
    if (v && typeof v === "object" && !Array.isArray(v) && typeof v.size === "string" && v.size) {
      return Object.assign({}, v);        // copy: the caller's object must not alias ours
    }
    return null;
  }

  function defaultStorage(root) {
    // Reading window.localStorage THROWS outright when cookies are blocked — not on
    // use, on access. So even picking the default is guarded.
    try { return root && root.localStorage ? root.localStorage : null; } catch (e) { return null; }
  }

  function create(opts) {
    opts = opts || {};

    // `key` is required and has NO default on purpose. Two apps on one origin share one
    // localStorage, and that is not hypothetical here: the demo is served from
    // <user>.github.io/niimbot-web-bluetooth/demo/, so every other page on that Pages
    // site is the same origin. A default key would silently merge two apps' memories.
    if (typeof opts.key !== "string" || !opts.key) {
      throw new Error("NiimbotLabelMemory.create: `key` is required (e.g. \"myapp:size-by-barcode\") — there is no default, so two apps on one origin cannot collide");
    }
    var key = opts.key;

    // Any object with getItem/setItem/removeItem. This is what makes the module
    // testable in Node with no browser, which is the reason the parameter exists.
    var storage = opts.storage || defaultStorage(root);

    // Every access is contained. This is a convenience layer over a driver whose print
    // path must keep working: a storage failure costs the memory, never the print.
    function readMap() {
      try {
        var map = JSON.parse((storage && storage.getItem(key)) || "{}");
        return map && typeof map === "object" && !Array.isArray(map) ? map : {};
      } catch (e) { return {}; }
    }

    function writeMap(map) {
      try {
        storage.setItem(key, JSON.stringify(map));
        return true;
      } catch (e) {
        // Quota, Safari private mode, storage absent. Report, never throw.
        if (root && root.console && root.console.error) {
          root.console.error("[label-memory] could not save: " + ((e && e.message) || e));
        }
        return false;
      }
    }

    var api = {
      key: key,

      // Every stored entry, normalised to records. Unreadable entries are dropped
      // rather than surfaced as junk the caller has to re-validate.
      all: function () {
        var raw = readMap(), out = {};
        for (var bc in raw) {
          if (!Object.prototype.hasOwnProperty.call(raw, bc)) continue;
          var rec = normalize(raw[bc]);
          if (rec) out[bc] = rec;
        }
        return out;
      },

      // → record object, or null. NOT a size id: callers must read `.size`.
      recall: function (barCode) {
        if (!barCode) return null;
        return normalize(readMap()[barCode]);
      },

      remember: function (barCode, value) {
        var rec = toRecord(value);
        if (!barCode || !rec) return false;
        var map = readMap();
        map[barCode] = rec;
        return writeMap(map);
      },

      forget: function (barCode) {
        if (!barCode) return false;
        var map = readMap();
        delete map[barCode];
        return writeMap(map);
      },

      clear: function () {
        try { storage.removeItem(key); return true; } catch (e) { return false; }
      },

      // Bulk-load a hand-written table — the rolls an app already knows about.
      //
      // Default is FILL GAPS ONLY. A seeded table is typed by hand and ships inside app
      // code; what is already stored was learned from an actual print on this user's own
      // printer. Hand-typed must not silently overwrite measured. `{ overwrite: true }`
      // is there for the deliberate reset.
      // Returns the number of entries actually written.
      seed: function (table, seedOpts) {
        if (!table || typeof table !== "object") return 0;
        var overwrite = !!(seedOpts && seedOpts.overwrite);
        var map = readMap();
        var written = 0;
        for (var bc in table) {
          if (!Object.prototype.hasOwnProperty.call(table, bc)) continue;
          if (!bc) continue;
          if (!overwrite && normalize(map[bc])) continue;
          var rec = toRecord(table[bc]);
          if (!rec) continue;
          map[bc] = rec;
          written++;
        }
        if (written && !writeMap(map)) return 0;
        return written;
      },
    };

    return api;
  }

  root.NiimbotLabelMemory = { create: create, VERSION: "1.0.0" };
})(typeof window !== "undefined" ? window : globalThis);
