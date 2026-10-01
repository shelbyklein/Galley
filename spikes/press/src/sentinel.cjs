// Sentinel colour assignment, shared by the Electron export step (writes the CSS)
// and the prepress step (reads build/sentinels.json written by the export step).
//
// Entry i gets RGB digits (d2,d1,d0) of i in base 16, each digit mapped to
// BASE + STEP*d. STEP=15 (>= 5 required) so Skia's float rounding can never make
// two sentinels collide, and BASE=10 keeps sentinels away from pure black/white,
// which are what Chromium itself emits for unstyled content.
const STEP = 15;
const BASE = 10;

function sentinelFor(i) {
  const d0 = i % 16, d1 = Math.floor(i / 16) % 16, d2 = Math.floor(i / 256) % 16;
  return [BASE + STEP * d2, BASE + STEP * d1, BASE + STEP * d0];
}

function assignSentinels(entries) {
  return entries.map((e, i) => ({ ...e, rgb: sentinelFor(i) }));
}

// Map a float triplet from a content stream (0..1 per channel) back to an entry:
// round each channel to the nearest 1/255, then exact match.
function lookupSentinel(table, r, g, b) {
  const R = Math.round(r * 255), G = Math.round(g * 255), B = Math.round(b * 255);
  return table.find((e) => e.rgb[0] === R && e.rgb[1] === G && e.rgb[2] === B) || null;
}

module.exports = { STEP, BASE, sentinelFor, assignSentinels, lookupSentinel };
