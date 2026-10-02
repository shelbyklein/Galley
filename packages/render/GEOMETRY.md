# Geometry: where things land in the PDF

P1-04. How the renderer places frames so that the printed PDF has them where the model says, and what Chromium does to
the page size. Everything here was measured in the PDF that Electron 44.5.1's `printToPDF` writes (Chromium 152, macOS),
by `npm run test:geometry`; re-run it after any Electron upgrade. Units are points (pt); 1 CSS px = 0.75 pt.

## Decision

| Thing | How it is drawn | Error in the PDF |
|---|---|---|
| Shapes (rect, ellipse, line, frame fills and strokes) | inline SVG, sheet-sized, in pt user units | 0.000 pt on edges and line ends, weight exact (0.25 pt) |
| **Text-frame origin** | `position: absolute; left: 0; top: 0; transform: translate(x pt, y pt)` (`htmlFrameStyle`) | **0.000 pt** on the first baseline, at fractional x, y, w, h and with rotation |
| Text-frame clip | `clip-path: inset(0)` on the frame box | 0.010 pt (the frame size, to 1/64 px) |
| Text inset | an inner box moved by `translate(inset, inset)`, not `padding` | 0.000 pt |
| Image frame | frame as above; the picture laid out at its natural pixel size, then `translate() scale()` | 0.000 pt on the picture, 0.002 pt on the clip |
| Export clip to the bleed box | `clip-path: inset(...)` on a wrapper around the page content | the frame-clip figure, 0.010 pt |
| Page size | `@page` a whole point larger than the sheet, then prepress sets the exact boxes | MediaBox, TrimBox and BleedBox exact |

Acceptance (P1-04): SVG shape edges within +/-0.05 pt and text-frame first-baseline origins within +/-0.05 pt. Measured:
both within 0.001 pt. The test fails if either moves past 0.05 pt.

## Why `left`/`top` was not enough

Chromium lays boxes out in 1/64 px and then **snaps** what it paints to whole CSS pixels in the places below. A CSS pixel
is 0.75 pt, so the error is up to 0.375 pt. Five frames at fractional positions (x 36.3, 150.37, 270.55, 250.55; y 99.1,
100.13, 200.77, 99.55; w 100.1, 90.3; Inter 12 pt on 18 pt), first baseline against `x` and `y + 13.5 pt`:

| Method | x error | y error |
|---|---|---|
| `left`/`top` in pt (the foundation's `htmlFrameStyle`) | 0.011 pt | **0.370 pt** (baseline snapped to a whole px) |
| SVG `foreignObject` at x, y | 0.011 pt | 0.370 pt (the same snapping) |
| `left`/`top` in whole px + `translate()` for the rest | 0.000 pt | 0.000 pt |
| **`translate()` from the origin** (chosen) | **0.000 pt** | **0.000 pt** |

The translation is written to the PDF as a matrix (`cm`), not laid out, so it is exact; the hybrid is the same thing
with extra steps. `foreignObject` also puts HTML inside an SVG coordinate system, which would be one more thing for the
Phase 2 thread engine to measure through, with no precision to gain.

The same snapping hits **clips and images**:

| | Error |
|---|---|
| frame clip with `overflow: hidden` | up to 0.350 pt (the clip is the frame size snapped to whole px: 100.1 pt clips at 99.75 pt) |
| frame clip with `clip-path: inset(0)` (chosen) | 0.010 pt |
| image with `left/top/width/height` in pt | up to 0.300 pt (position and size snap) |
| image laid out at its natural pixel size, placed and scaled with `translate() scale()` (chosen) | 0.000 pt |

So frames must **not** get `overflow: hidden` (a test checks that `page.css` and `htmlFrameStyle` have none), and images
are never sized in pt.

### The inset

`padding` of 3.6 pt is 4.8 px, and the text baseline lands on a whole pixel, so a frame with that inset printed its first
baseline 0.15 pt low. The inset is therefore an inner box moved by `translate(inset, inset)` with width `w - 2 * inset`
(only when `inset > 0`); the clip stays the frame's, as in InDesign. Measured 0.000 pt.

### What is still not exact: the baseline offset inside a frame

The first baseline is `half-leading + ascent` below the box top, and Chromium rounds the font's ascent and descent to whole
pixels and puts the baseline on a whole pixel. For a leading that is a multiple of 0.75 pt (a whole number of pixels) with
an even `leading - (ascent + descent)` in px, the offset is exact: Inter 12 pt on 18 pt gives 13.5 pt, as computed.
Other leadings are not: 12 pt Inter on 13 pt leading measured 10.5 pt where the model's centered line box gives 11.0 pt.
That is a property of the layout engine, identical on screen and in print (same box, same rounding), so the line-match
tests that compare screen with PDF are unaffected. It is exactly what **P2-08** has to prove for leadings of 12, 13, 13.5,
14.5 and 15.25 pt; this file only records that the offset can be up to 0.5 pt off the ideal.

### Phase 2 verification

P2-08 verifies identical line breaks at all five required leadings; arbitrary leading remains allowed. Unaligned native
text still has pixel quantization inside its line boxes. The UI-built flyer measures actual DOM baselines and PDF text
origins independently: 61 lines match, with at most 0.374951 pt of absolute baseline error. Its 0.5 pt bound rejects a
1 pt uniform displacement even when every line's text matches.

Grid-aligned stories use native CSS layout at `zoom: 32` with a reciprocal transform in measurement, editing, static
rendering and export. This reduces paint quantization to 0.0234375 pt. Measured first-baseline padding and grid-derived
leading are view data; the source paragraph's leading is preserved. Grid tests measure actual PDF text origins, rather
than line-box centers, and pass the stricter 0.1 pt acceptance bound (maximum measured PDF error 0.0328 pt).

## Page size

`printToPDF({ preferCSSPageSize: true })` gives the page size in the CSS `@page` rule, but Chromium **rounds each side to
a whole number of points** (then to 1/300 in, 0.24 pt, units), and not always in the same direction. Asking for the sheet
itself, over 100 sizes from 100 to 2000 pt:

- the MediaBox came out from **0.60 pt smaller to 0.61 pt larger** than asked (A4 595.28 x 841.89 pt became 594.96 x 841.92);
- a page smaller than the content makes Chromium shrink the content to fit; this is what `overflow: hidden` on the sheet
  and the rule below are for.

The export page therefore sets `@page { size: (ceil(sheet width) + 1)pt (ceil(sheet height) + 1)pt }`. Whole points map to
themselves (to 0.12 pt), so Chromium's page is then **0.94 to 2.05 pt larger** than the sheet, in all 100 sizes, never smaller,
always exactly one page. The sheet itself is the `.galley-page` element at its exact size, `overflow: hidden`, anchored at
the top-left (the CSS origin), so the extra page area is empty.

`@galley/prepress` then makes the page exact: it moves the content down by (sheet height - Chromium page height) so that the
top-left corner stays where it was, and writes MediaBox = CropBox = the sheet, TrimBox = exactly the page size, BleedBox =
trim + the bleed on each side, all from the model, to the point. The old plan's rule "page padding is a multiple of 0.24 pt"
is not needed: nothing in the renderer depends on the page size being a multiple of anything.

## Rules for the other lanes

- Place text and image frames only with `htmlFrameStyle`. Never `left`/`top`/`width`/`height` in pt on a frame that has to
  print exactly, and never `overflow: hidden` on a frame or a slot (use `clip-path`).
- Inside a frame, lay out in whole pixels where it matters and use `transform` for everything fractional.
- Phase 2 text slots: a slot is a frame; keep its exact transform positioning and move its content with a transform, not
  a margin. P2-08 permits arbitrary leading; retain the shared higher-precision layout for grid-aligned stories.
- Colors never come from this module: see `color.ts` and the export-mode sentinels.

## How it is measured

`scripts/geometry/run.ts` (`npm run test:geometry`):

1. **The lab** prints each candidate method as plain HTML with the export's `printToPDF` options and measures the PDF with
   `measurePdfGeometry` (`@galley/prepress/verify`), a content-stream interpreter that tracks the CTM through `q Q cm`
   and reports painted path boxes, clips, image placements and text origins from the top-left of the MediaBox.
2. **The page-size sweep** asks Chromium for 100 sheet sizes both ways.
3. **The real renderer**: the fractional document `scripts/geometry/doc.ts` goes through the app's own export pipeline
   (`window.__galleyExport`, started with `GALLEY_E2E=1`), and Chromium's PDF is measured against the model's numbers.
