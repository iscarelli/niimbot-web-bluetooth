/* Harness: connect()'s "no Web Bluetooth" error — does it tell "this browser doesn't
 * expose the API" apart from "this page isn't a secure context"?
 *
 * No dependencies, no runner: `node test/bluetooth-unsupported.test.js`. Exits
 * non-zero on failure. NO PRINTER IS INVOLVED — `navigator.bluetooth` is absent from
 * the fake `navigator` itself, so connect() throws before any GATT call is made.
 *
 * Why this exists: a real user hit the
 * old single-cause message on HTTPS and went looking for an HTTPS problem that didn't
 * exist — their browser (Brave) simply doesn't expose Web Bluetooth, flag or no flag.
 * `!navigator.bluetooth` alone can't say which case it is; `isSecureContext` can,
 * because it's the one thing the browser itself gates the API on.
 *
 * `globalThis.navigator` MUST exist before src/niimbot.js loads: IS_MAC reads
 * navigator.platform at load time (see CLAUDE.md). Node ≥ 21 already defines a
 * `navigator` global as a getter-only property, so it takes defineProperty to
 * replace it — a plain assignment throws.
 */
"use strict";
const assert = require("node:assert/strict");

// ── Browser globals, installed BEFORE the driver loads ───────────────────────
// No `bluetooth` key at all — this is the "API not exposed" shape, same as a real
// Brave tab with the flag off, and the same as any browser with no Web Bluetooth.
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: {
    platform: "Win32",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
  },
});

// The driver's IIFE closes over `typeof window !== "undefined" ? window : globalThis`
// as `root`, and reads `root.isSecureContext` — so on Node (no `window`) that's this
// process's globalThis, set per case below before each connect() call.
delete globalThis.isSecureContext;

// ── Load the driver (attaches globalThis.Niimbot) ────────────────────────────
require("../src/niimbot.js");
const Niimbot = globalThis.Niimbot;

(async () => {
  // ── isSupported() stays the plain, unchanged signature ─────────────────────
  assert.equal(Niimbot.isSupported(), false, "isSupported() must still be !!navigator.bluetooth, unchanged");

  // ── secure context, no API → blame the BROWSER, not HTTPS ──────────────────
  globalThis.isSecureContext = true;
  await assert.rejects(
    () => Niimbot.connect(),
    (e) => {
      assert.match(e.message, /doesn't expose Web Bluetooth/i, "must say the browser doesn't expose the API");
      assert.doesNotMatch(e.message, /https/i, "must NOT send a secure-context user chasing HTTPS");
      assert.match(e.message, /Brave/i, "must name the browser most likely to hit this (Brave)");
      return true;
    },
    "isSecureContext=true must produce the browser-lacks-API message"
  );
  console.log("ok  (a) secure context + no navigator.bluetooth → browser-lacks-API message, no HTTPS mention");

  // ── insecure context, no API → the existing HTTPS/localhost message is right ──
  globalThis.isSecureContext = false;
  await assert.rejects(
    () => Niimbot.connect(),
    (e) => {
      assert.match(e.message, /https/i, "insecure context must still point at HTTPS/localhost");
      return true;
    },
    "isSecureContext=false must keep the original HTTPS message"
  );
  console.log("ok  (b) insecure context + no navigator.bluetooth → HTTPS message unchanged");

  console.log("PASS — the two \"no Web Bluetooth\" causes produce different messages. NO PRINTER RAN THIS TEST.");
  process.exit(0);
})().catch((e) => { console.error("FAIL —", e && e.message ? e.message : e); process.exit(1); });
