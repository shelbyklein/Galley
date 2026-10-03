# Galley: plan (draft v0.1)

A desktop page-layout app built on web technology. Its main output is press-ready PDF for brochures, pamphlets and posters. Its second output is responsive HTML. Content is written once and served by two rulesets.

**Architecture requirement reaffirmed (2026-10-02):** CSS must drive document layout and rendering, not just the app interface. Keep Chromium/CSS; a browser-hosted custom Rust renderer does not meet this requirement.

## Decisions so far

| Question | Decision |
|---|---|
| Who it's for | Me / my studio. Single user, local files, no accounts. |
| Print bar | Commercial press-ready: CMYK, spot colors, bleed and marks, PDF/X. |
| Web output | Shares content and styles with print. The web gets its own responsive layout, auto-drafted from print. |
| Platform | Desktop app built on Electron, **pinned to 44.5.1** (the version both Phase 0 spikes were verified on). |
| Architecture | **Confirmed by Phase 0** (2026-10-01): Chromium renders both the editor and the PDF, and a sentinel-color prepress step makes the output press-ready. See `spikes/*/FINDINGS.md`. |
| Editor UI | Familiar InDesign layout: dark theme, tools on the left, control strip on top, docked panels on the right. |
| Tracking | One GitHub issue per plan in `shelbyklein/Galley`. No Tracker Trapper. |

---

## 1. The core idea: one source, two rulesets

```
              ┌────────────── Shared source ──────────────┐
              │  Stories (rich text)    Assets (images)    │
              │  Swatches               Styles             │
              └────────┬─────────────────────────┬────────┘
                       │                         │
               PRINT RULESET               WEB RULESET
         pages · frames · threads     sections · blocks · breakpoints
         parents · bleed · baseline   fluid type · srcset · semantics
                       │                         │
                 PDF/X-4 file              HTML/CSS bundle
```

Content is written once. Each ruleset decides where the content goes and how it is set. A story can appear in both outputs or in only one. A "scan for the web version" QR code is print-only, for example, and a nav bar is web-only.

**Styles have three layers:**
- **Shared:** font family, weight, case, color swatch, tracking, semantic role (heading, body, caption)
- **Print:** size and leading in pt, hyphenation, baseline grid, space before and after, overprint
- **Web:** fluid size (`clamp()`), line-height, breakpoint overrides, HTML tag

**Swatches have two definitions.** Print uses a CMYK or spot definition. The web uses an sRGB value, computed through an ICC profile and overridable (for example, a Pantone color's official sRGB value).

**Images:** print uses the full-resolution original, converted to CMYK on export. The web uses generated AVIF/WebP versions with `srcset`. The two rulesets can crop the same image differently.

---

## 2. The architectural bet

For a layout tool, the line breaks on screen must exactly match the line breaks in the PDF. If they don't, text that fit in the editor can overflow at the printer.

**Electron provides this.** The editor draws pages with Chromium's layout engine, and the same Chromium in the same app produces the PDF (`webContents.printToPDF`). With the same engine and the same font files, the line breaks are identical.

**The catch is that Chromium only writes RGB PDFs.** Galley therefore adds its own prepress stage, which turns Chromium's PDF into a press-ready one:

1. **Render in export mode.** Every swatch and tint is temporarily given a unique "sentinel" RGB value, so its color can be found in the PDF later. Images can be swapped for full-resolution originals.
2. **`printToPDF`** at trim + bleed + slug size, with zero margins and scale 1.
3. **Prepress post-processor** (TypeScript, pdf-lib, and a small content-stream rewriter):
   - Sentinel RGB values become the exact CMYK (`k`/`K`) or spot (`/Separation`) values. Nothing goes through ICC conversion, so 100K black text stays on the black plate and the rich-black text problem never occurs.
   - Overprint flags become ExtGState `/OP true`.
   - Images become CMYK-converted full-resolution versions. Alternatively they stay ICC-tagged RGB, which PDF/X-4 allows.
   - Adds page boxes (Media/Bleed/Trim), crop, bleed and registration marks, and slug info.
   - Adds the output-intent ICC profile and PDF/X-4 metadata.
4. **Preflight** runs on the document model before export and blocks or flags problems: low effective PPI, RGB images, missing fonts, overset text, objects that stop at trim instead of bleed, hairlines, ink coverage over 300%.

**Fallback if the post-processor hits a wall:** Chromium still breaks the lines, but Galley draws the glyphs. We read line boxes from the DOM and write the PDF ourselves with fontkit and pdf-lib. That is more work but gives full control, and the line breaks stay identical. The document model is the same either way, so this replaces only the export module.

**Why not a custom engine on canvas, like Figma?** It gives the best typography and the most control. It also means writing our own text shaping, line breaking, text editing, IME and accessibility, which is a multi-year project. For brochures, pamphlets and posters, Chromium's typography is good enough: OpenType features, hyphenation, `text-wrap: pretty` and `text-box-trim`. The main gap is InDesign's paragraph composer for justified body text.

---

## 3. Hard problems and how we'll approach them

| Problem | Approach |
|---|---|
| Threaded text frames (CSS has no native threading) | **Proven in Phase 0.** Each frame is laid out in a hidden measuring host; the story splits at the last line that fits and continues in the next frame. Incremental re-threading takes under 3 ms per key for brochure-length stories, and on-screen lines matched the PDF on 2,205 of 2,205 lines. |
| Editing text that runs across frames | **Proven in Phase 0.** One ProseMirror view sits over a derived "view doc"; the story doc is the source of truth, and undo lives on the story. |
| Geometry precision | **Found in Phase 0:** CSS boxes snap to whole CSS pixels (0.75 pt) in the PDF. Draw fills, strokes and rules as SVG, which is exact. Phase 1 decides how text-frame origins are positioned exactly. Page padding is a multiple of 0.24 pt, and the sheet is always clipped with `overflow: hidden`. |
| Leading | **Found in Phase 0:** fixed leading that is a multiple of 0.75 pt gets exact line positions. Other values use a measured fallback, which Phase 2 must verify against print. |
| Text wrap around objects | Inject invisible floats with `shape-outside` into the affected text frame (left and right sides). Jump-object wrap comes later. |
| Baseline grid | Snap line-height to grid increments and use `text-box-trim` to put the first baseline on the grid. |
| On-screen color accuracy | Soft proof: render CMYK swatches through the chosen press profile to display RGB with LittleCMS (WASM). |
| Fonts | Scan system and document fonts in the main process with fontkit. Load them with `@font-face` from the exact files, so the editor and the export use the same font. Check fsType embedding permissions. |
| Fonts in PDF | **Found in Phase 0:** only static TrueType embeds as a real font. Variable fonts and every CFF `.otf` come out as Type 3 (legal in PDF/X-4 and K-only, but unhinted, and some shops flag it). **Default:** allow any font. Variable fonts are pre-instanced to static fonts at export, and the export dialog warns about CFF `.otf`. A Type 3 → real-font rewrite is planned for Phase 4. |
| Chromium upgrades changing line breaks | Store the engine version in each document and warn when text reflows after an Electron upgrade. InDesign has the same problem when its composer changes. |

---

## 4. Document model (sketch)

```ts
Document {
  meta:     { title, colorProfile, engineVersion }
  swatches: Record<Id, Swatch>              // cmyk | spot | rgb, + web sRGB, tints
  styles:   { paragraph, character, object } // shared + print + web layers, basedOn
  stories:  Record<Id, Story>               // ProseMirror JSON
  assets:   Record<Id, Asset>               // linked path, hash, ppi, color space

  print: {
    pageSize, bleed, slug, facingPages, fold?,
    parents: Record<Id, ParentPage>,        // master pages
    spreads: Spread[] → pages → frames (text | image | shape | group)
    threads: { storyId, frameIds[] }[]
  }

  web: {
    breakpoints,
    sections: Section[] → blocks referencing storyId / assetId (or web-only content)
  }
}
```

- All units are stored in points (1/72 in), the native unit of PDF. CSS `pt` maps one-to-one.
- Objects are stored by ID, which keeps undo/redo (Immer patches) simple and leaves room for sync later.

**File format:** a `Brochure.galley/` folder that macOS shows as a single file:
- `document.json`: the model, readable and diffable
- `links.json`: images linked by relative path plus a hash, so a Links panel can detect missing or modified files
- `fonts/`: document fonts
- `previews/`: thumbnails and image proxies

A **Package** command collects everything for handoff.

---

## 5. Tech stack

- **Shell:** Electron, Vite, React, TypeScript
- **State:** Zustand and Immer (patches give undo/redo)
- **Text:** ProseMirror (story model and editing)
- **Fonts:** fontkit
- **Images:** sharp (proxies, CMYK conversion, web versions)
- **Color:** LittleCMS (WASM) for soft proofing
- **PDF:** pdf-lib (or a maintained fork) plus a content-stream tokenizer
- **Tests:** Playwright for Electron, and golden PDF tests that render pages to PNG, diff them, and check separations

```
packages/model      document schema, commands (no DOM)
packages/render     page renderer + threading engine (shared by editor and export)
packages/prepress   PDF post-processor + preflight
packages/web        HTML/CSS generator
apps/desktop        Electron main process + UI
```

**Key rule:** the editor and the exporter use the same page renderer. Editor chrome (selection handles, guides, frame edges) lives on a separate overlay layer, so the exported pages contain only the page itself.

---

## 6. Roadmap

Each phase ends with a real job, not a feature checklist.

### Phase 0: Prove the bet (spikes): done, 2026-10-01
Both spikes hold, with caveats. Details: [press findings](spikes/press/FINDINGS.md) and [threading findings](spikes/threading/FINDINGS.md). The plates were confirmed in Acrobat Output Preview; the print shop's view of Type 3 fonts is still open.

Two throwaway prototypes that decide whether the architecture holds:
- **Press spike:** one page with CMYK text, a spot color, 100K black text, a gradient, a transparent object, a photo and a variable font. Run it through Electron `printToPDF`, then prepress, to get PDF/X-4. Check separations in Acrobat's Output Preview and send it to your print shop.
- **Threading spike:** three linked frames of different widths, live re-threading while typing, and an overset marker.

**Exit:** both spikes work, or we switch the export module to the fallback before building on top of it.

Phases 1–2 are planned in detail in [docs/plans/phases-1-2.md](docs/plans/phases-1-2.md).

### Phase 1: Canvas foundation
- Basic PDF/X-4 export with bleed and crop marks, ported from the press spike (moved up from Phase 4)
- Electron shell; open and save `.galley` files
- Pages with margins, columns, bleed and slug
- Zoom and pan, rulers and guides
- Rectangle, ellipse, line, text and image frames
- Select, move, resize and rotate; smart guides and snapping
- Layers; undo and redo

**Milestone:** lay out a one-page poster (without text styling) and export it as press-ready PDF.

### Phase 2: Typography
- Story editing
- Paragraph and character styles (based-on, shared and print layers)
- Font manager and OpenType features
- Threading and overset
- Baseline grid and text wrap

**Milestone:** rebuild a real one-page flyer you've made in InDesign.

### Phase 3: Color and images

Implementation plan: [phase-3.md](docs/plans/phase-3.md), tracked in [issue #2](https://github.com/shelbyklein/Galley/issues/2). Existing CMYK/spot/tints and soft proofing carry forward; remaining work is image-content adjustment, links/PPI, and user swatch libraries. Phase 2 acceptance gates remain open independently.
- Swatches: CMYK, spot libraries, tints
- Soft proofing
- Placing images with fit and crop
- Links panel and effective PPI

### Phase 4: Press output
- Export presets (PDF/X-4, plus an X-1a option), building on Phase 1's basic export
- Type 3 → real-font rewrite for CFF `.otf` fonts
- Bleed and marks
- Preflight panel
- Package

**Milestone:** a real job printed by a commercial printer with no fixes needed.

### Phase 5: Multi-page production
- Parent pages, facing pages and spreads
- Page numbers and sections
- Fold layouts (tri-fold, z-fold, gate fold) with fold guides and panel-width compensation for roll folds
- Object styles, find/change and basic tables

**Milestone:** a tri-fold brochure and an 8–12 page booklet.

### Phase 6: Web ruleset
- Web layout mode beside print, auto-drafted from print reading order
- Section and block layout patterns, and breakpoints
- Web style layer and image derivatives
- HTML export
- Web preflight: alt text, contrast, and web-licensing for fonts

**Milestone:** publish the Phase 5 brochure as a responsive page.

### Later / maybe
- IDML import, to bring in existing InDesign files
- Templates and data merge
- A scripting API, plus an MCP server so Claude can drive Galley
- Richer tables
- Real-time collaboration

---

## 7. Risks to watch

- **PDF/X validation:** checking output needs Acrobat Preflight, callas pdfToolbox (paid), or the print shop's own preflight. Pick one early.
- **ICC profile licensing:** bundle freely distributable profiles (ECI, IDEAlliance) or let you point Galley at your own.
- **Scope creep:** InDesign has 25 years of features. The phase milestones keep us shipping real jobs.
- **pdf-lib maintenance:** the original package is quiet. Use a maintained fork or a small Rust/WASM PDF crate if needed.

---

## 8. Open questions

1. **IDML import:** how much existing InDesign work do you want to bring in? It's a big effort with high value.
2. **Print profile:** which print shop or profile do you usually target? GRACoL/SWOP is common in the US, FOGRA in Europe.
3. **Justified text:** is justified body text common in your work? That decides how much the paragraph-composer gap matters.
4. ~~**Threading:**~~ Settled: it's in Phase 2, and Phase 0 proved it works.
5. **Type 3 fonts:** what does your print shop say about Type 3? The answer sets how urgent the Phase 4 font rewrite is.
6. **InDesign habits:** which InDesign workflows do you love or hate, and which should Galley do differently?
