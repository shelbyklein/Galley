# Press spike: findings

**Verdict: the bet holds, with caveats.** Chromium plus a sentinel-color post-processor produces exact CMYK and spot output with no ICC conversion of vector colors. The fallback (Galley writes the PDF itself) is not needed for color.

- `npm run spike` passes 60/60 checks
- `npm test` passes 10/10
- `qpdf --check` is clean

```
npm install && npm run spike   # ~5 s: assets → export → prepress → verify; exits non-zero on any failure
npm run experiments            # side experiments: page size, snapping, fonts, gradients, CSS features
```
`hb-subset` is optional; it is only needed for the static-instance font line. npm 11 blocks Electron's postinstall, so `package.json` has an `allowScripts` entry for it.

## Measured results
Ghostscript `tiffsep` at 144 dpi.

| Check | Result |
|---|---|
| 100K body text | C/M/Y/spot read 0.0, K reads 100. Same for the variable-font line and the static-instance line. |
| Spot color | `PANTONE 185 C` is on its own plate at 100%, and its 40% tint reads 40%. CMYK plates are empty there. |
| Background | C0 M60 Y100 K0, to the bleed edge and no further |
| Headline | C100 M80 Y0 K20 |
| Teal / 50% tint | 85.1/9.8/40.0/9.8 and 42.4/4.7/20.0/4.7 |
| Gradients (2 and 3 stops) | Linear in CMYK. The cyan→magenta midpoint reads C50.0 M50.0. |
| 50% transparency | Orange over cyan gives 49.8/30.2/50.2/0 (expected 50/30/50) |
| Overprint | Overprint text keeps M60 Y100 K100. Knockout text is K100 only. Overprint does not leak onto later objects. |
| Leftover RGB | None in vector colors, images, shadings, groups or resources |
| Baseline (naive RGB → Ghostscript) | Black text becomes rich black (C68 M68 Y65 K74) and the spot plate disappears. The checks discriminate. |

Shadows, blurs, masks, multiply blends, text stroke, gradient text, rotated or rounded images and SVG were each printed alone, out of 17 CSS features tested. All came out with no RGB left and ink only on the expected plates.

## What Skia emits
- **Colors:** exact sentinel `rg`/`RG`, written to 4 decimals. The worst mapping error was 0.0125 of a level.
- **Gradients:**
  - Linear and radial gradients are native shadings, function types 2 and 3.
  - Conic and repeating gradients use a type 4 PostScript function.
- **Opacity:** a transparency-group form with no `/CS`, and no page `/Group`.
- **Photos:** the original JPEG passes through at full resolution, ICC-tagged when the file has a profile.

## Caveats, ranked
1. **Fonts.** Variable fonts and every CFF `.otf` come out as **Type 3**. Only static TrueType embeds as proper CID TrueType.
   - Adobe Garamond Pro and Noto Sans CJK both became Type 3, and `~/Library/Fonts` holds 133 `.otf` files.
   - Pre-instancing variable fonts with `hb-subset` works.
   - Type 3 is legal in PDF/X-4 and separates K-only, but it is unhinted and some print shops flag it.
   - A Type 3 → real-font rewrite looks feasible, because glyph names encode glyph IDs and every glyph has an explicit position. It is the only fix that covers CFF `.otf`. Not built yet.
2. **Alpha that isn't plain opacity.**
   - Gradient-to-transparent is rasterized as a page-size 72 ppi RGB image plus a soft mask.
   - The single-swatch case is recolored to exact CMYK; a fade measured K-only.
   - Mixed-color rasters are refused rather than converted wrongly.
   - Not handled: conic and repeating gradients, CSS color hints, and alpha gradients between two different swatches.
3. **Geometry.**
   - CSS boxes snap to whole CSS pixels (0.75 pt), so a 0.25 pt rule prints at 0.75 pt. Inline SVG is exact.
   - Page size is quantized to 0.24 pt; A4 comes out 594.96 × 841.92.
   - Content wider than the page triggers shrink-to-fit; clipping the sheet with `overflow: hidden` prevents it.
4. **Photo conversion.**
   - sharp is within 1.5 points per plate of Ghostscript through the same profile, but gives no control over rendering intent or black point compensation.
   - CMYK photos make the file 6.8 MB. `--photo=rgb-icc` (ICC-tagged RGB, allowed in PDF/X-4) gives 1.9 MB and also passes.
5. **External validation is partial.** Shelby checked the PDF in Acrobat Pro's Output Preview on 2026-10-01 and it looked good: the expected plates, the values and the overprint behavior. It has not yet been through a print shop's preflight.
6. **Output profile.** The spike uses Adobe's `CoatedGRACoL2006.icc` from this machine. Don't bundle it until its license is checked.

## Not tested yet
- Overprint inside a transparency group
- Restricted-embedding fonts
- Non-sRGB photos
- Multi-page jobs
- Spot colors inside gradients (the rewriter reports this as unsupported)

## Next steps
1. **Font strategy:** ask the print shop about Type 3, pre-instance variable fonts, and/or build the Type 3 → real-font rewrite.
2. **External check:** ~~Acrobat Output Preview~~ is done (2026-10-01). Still to do: send the PDF to the print shop, and ask about Type 3 fonts.
3. **Renderer rules:**
   - Draw frame fills, strokes and rules as SVG.
   - Choose page padding as a multiple of 0.24 pt.
   - Always clip the sheet with `overflow: hidden`.
4. **Gradient model:** limit Galley's model to stops only. Encode fades as sentinel pairs so prepress can emit a native shading plus soft mask.
5. **Promote the code:** move it to `packages/prepress`, make the `tiffsep` measurement a golden test, and pin Electron.
6. **Color management:** use LittleCMS for photos and soft proofing, and decide the output profile and its license.

## Outputs
All under `out/`:
- PDF: `galley-press-spike.pdf`
- Previews: `preview.png`, `preview-overprint.png`, `screen-softproof.png`
- Plates: `sep/` and `separations-contact-sheet.png`
- Reports: `verify-report.txt` / `.json` and `galley-press-spike.report.json`
- Experiment log: `experiments.txt`
