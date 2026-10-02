# Text model v2 (`formatVersion: 2`)

P2-01. How text is stored, styled and threaded, and the decisions behind it. Everything here is in `packages/model/src/text/`
(plus `commands/{story,style,thread}.ts`, `migrate/v1.ts`, and the checks in `validate.ts`). The renderer's style-to-CSS half
is `packages/render/src/styles/resolve.ts`. The plan is `docs/plans/phases-1-2.md`; the thread engine this model is shaped for
is `spikes/threading` (ported in P2-02).

## At a glance

```
document
  paragraphStyleOrder, paragraphStyles   [Basic Paragraph] (id basic-paragraph) + user styles
  characterStyleOrder, characterStyles   [None] (id none) + user styles
  baselineGrid                           { start, increment }, points
  stories[id]                            { id, frameIds, doc }
  frames[id] (type text)                 { storyId, inset, textWrap?, ...box }
  frames[id] (any box frame)             { textWrap? }
```

* A **story** is the text; its `frameIds` is the **thread**, the ordered chain of text frames that show it. Every text frame
  names its story, and the story lists the frame exactly once (the validator checks both directions).
* A story's `doc` is ProseMirror JSON: `doc > paragraph+ > text*`. A paragraph points at a **paragraph style** and may carry
  local **overrides**; a run points at a **character style** (a `charStyle` mark) and may carry local overrides (an
  `override` mark). There is no other inline markup and no other node type.
* A **style** is `{ id, name, basedOn, shared, print, web }`: three layers of properties, each a partial set. What a paragraph
  or run looks like is the *resolution* of its chain (below), never a stored value.

## Story document

```jsonc
{
  "id": "story_1",
  "frameIds": ["frm_a", "frm_b"],                      // the thread, in reading order
  "doc": {
    "type": "doc",
    "content": [
      { "type": "paragraph",
        "attrs": { "style": "body", "overrides": { "print": { "align": "center" } } },   // overrides optional
        "content": [
          { "type": "text", "text": "Plain " },
          { "type": "text", "text": "bold", "marks": [ { "type": "override", "attrs": { "shared": { "fontWeight": 700 } } } ] },
          { "type": "text", "text": "styled", "marks": [ { "type": "charStyle", "attrs": { "style": "emphasis" } },
                                                         { "type": "override", "attrs": { "print": { "fontSize": 14 } } } ] }
        ] },
      { "type": "paragraph", "attrs": { "style": "body" } }     // an empty paragraph has no content
    ]
  }
}
```

Canonical form (what the validator accepts and the commands store):

* `attrs` is exactly `{ style, overrides? }`; `overrides` is absent unless it holds at least one property.
* A text node's `text` is never empty; `marks` is absent unless non-empty, holds at most one `charStyle` then at most one
  `override`, and an `override` holds at least one property. Neighbouring runs with equal marks are merged.
* No `charStyle` mark means [None]; a mark that names `none` is rejected.
* Every id resolves: paragraph styles, character styles, swatches used by an override's `fill`.

`normalizeStoryDoc(doc)` produces this form from anything close (ProseMirror's `toJSON()` writes `overrides: null` and view-only
attributes such as the engine's `cont` and `tail`; it drops them, drops empty overrides and merges runs). `story.setDoc`
normalizes before it validates, so a ProseMirror view can hand its JSON straight to the command.

`storyDocSchema` (zod) is the shape check, `storyDocReferenceProblem` the reference check, `storyDocProblem` the first.

### How v1 bold and italic map

v1 stories had a `defaults` object and `strong` / `em` marks (CSS `bolder` and italic). In v2 there is no `strong` or `em`:
a bold run is an `override` mark with an explicit weight, an italic run one with `fontStyle: italic` (both in one mark when
both apply). The migration computes the weight `bolder` gave: 400 to 700, 700 and above to 900. Why not keep `strong` / `em`:
the brief names exactly two inline mechanisms (character style, local override), a third way to say "bold" would have to be
resolved against both, and an explicit weight tells the font manager (lane N) exactly which face a run needs. Toggling bold in
the editor is therefore "set `shared.fontWeight` to the family's bold weight" or "unset it" (`story.setOverrides`), not a mark.

## Styles

### Layers and properties

Every property belongs to one layer and is optional in a style (absent means inherited). Names are unique across layers.

| Layer | Paragraph styles and overrides | Character styles and override marks |
|---|---|---|
| **shared** | `fontFamily`, `fontWeight` (1 to 1000), `fontStyle` (normal, italic), `fill` (a paint: swatch, tint, overprint), `tracking` (1/1000 em), `kerning` (metrics, none), `textCase` (normal, allCaps, smallCaps), `features` (OpenType tag to boolean), `language` (BCP 47), `role` (body, heading, subhead, caption, quote, or null) | the same without `role` |
| **print** | `fontSize`, `leading` (any positive pt), `firstLineIndent` (negative hangs), `leftIndent`, `rightIndent`, `spaceBefore`, `spaceAfter`, `align`, `hyphenate`, `hyphenMinWord`, `hyphenMinBefore`, `hyphenMinAfter` (null: the engine's limit), `hyphenLadder` (null or 0: unlimited), `alignToBaselineGrid`, `dropCapLines` (0: none), `dropCapChars` | `fontSize`, `leading`, `baselineShift` (positive up) |
| **web** | `fontSize`, `lineHeight` (CSS strings), `tag`, `breakpoints` (`{ name: { fontSize, lineHeight } }`) | the same shape, ignored when drawing |

All print lengths are points. `web` is stored and shown, never used by the print renderer; Phase 6 edits it. `features` and
`breakpoints` merge key by key down a chain; every other property replaces. `[Basic Paragraph]` stores every shared and print
property explicitly (`BASIC_PARAGRAPH_PROPS` in `props.ts` is where its values come from: Inter Regular 12/15 pt, [Black],
flush left, hyphenation on), so a document never changes if the constants change.

### Built-in styles

* `basic-paragraph` `[Basic Paragraph]`: cannot be deleted or renamed, has no base, **its properties can be edited** (it is the
  document's default text).
* `none` `[None]`: the character style that does nothing; cannot be edited, renamed or deleted, never appears as a mark.

### `basedOn`

`basedOn` is a style id or `null` (nothing). A chain must end: `setStyle` and `addStyle` reject a base that would make a style
based on itself (`basedOnProblem`), `validateDocument` reports `style-cycle` for a hand-edited file, and `styleChain` throws
`StyleChainError`. A paragraph style based on nothing starts from the constants, not from `[Basic Paragraph]`'s stored values;
the UI creates new styles based on `[Basic Paragraph]`.

### Resolution (what a paragraph or run looks like)

```
paragraph  = constants -> style chain, root to leaf -> the paragraph's local overrides
run        = the resolved paragraph -> character style chain, root to leaf -> the run's override mark
```

`resolveParagraphStyle(doc, id)` (cached per style table), `resolveParagraph(doc, attrs)`, `resolveRun(doc, resolvedParagraph,
marks)`. All three return the same flat `ResolvedParagraph` with every property set; a run changes only what character styles
may change and keeps the paragraph's indents, alignment and so on. An unmarked run returns the paragraph object itself.
`doc` can be a whole document or just `{ paragraphStyles, characterStyles }`.

### Style commands

`style.add`, `style.set` (replace a definition; this is New, Edit and Redefine), `style.move`, `style.remove`, each with a
`kind` of `paragraph` or `character`. Removing a style moves its paragraphs to a replacement (default `[Basic Paragraph]`; for a
character style `null` removes the mark), and folds what it set into the styles based on it so none of them changes look. A
swatch removal drops the swatch from style layers and local overrides too (text with no color inherits; `[Basic Paragraph]`
falls back to [Black]).

## Local overrides and formatting commands

Overrides are the three layers again, each optional, holding only what differs: `attrs.overrides` on a paragraph,
`attrs` of an `override` mark on a run. `hasParagraphOverrides` is what the Paragraph Styles panel marks with `+`.

Positions are the model's own (no ProseMirror needed): a **point** is `{ paragraph, offset }` (paragraph index, UTF-16 offset in
its text) and a **range** is `{ from, to }`, reversed ranges allowed. A collapsed range formats no characters; paragraph-level
operations affect every paragraph a range touches.

| Command | Does |
|---|---|
| `story.setDoc` | replace the text (normalizes, validates shape and references) |
| `story.applyParagraphStyle` | style for the touched paragraphs; `clearOverrides` drops their overrides too |
| `story.applyCharacterStyle` | character style on the characters (`null` or `[None]` removes it); overrides stay |
| `story.setOverrides` | `target: paragraph or character`, `patch: { set, unset }` (merge properties, drop named ones) |
| `story.clearOverrides` | `scope: paragraph, character or all` (character styles stay) |

The same operations as pure functions on a document (`setParagraphStyleInDoc`, `applyCharacterStyleInDoc`,
`patchParagraphOverridesInDoc`, `patchCharacterOverridesInDoc`, `clear...InDoc`, `patchOverrides`) are exported for the editor.

## Threads

A story owns its chain: `story.frameIds` (reading order), and each text frame has `storyId`. A story with one frame is the
unthreaded case. Deleting a text frame (`frame.remove`, a page or a layer) removes it from its chain, and deletes the story
when it was the last frame. Frames of one thread may be on different pages and layers.

| Command | Rule |
|---|---|
| `thread.link { fromId, toId }` | out-port to in-port. `fromId` is the **last** frame of its thread, `toId` the **first** of a different one. The two threads join; the second story's text is appended (nothing is added when it is empty), and its story is deleted. |
| `thread.insert { frameId, targetId, position }` | an empty unthreaded frame goes `before` or `after` any frame of a thread. |
| `thread.unlink { frameId, newStoryId }` | break the thread before `frameId` (not the first). It and the frames after it get a new empty story; **all text stays in the first story**, so the first frames may become overset. |
| `thread.remove { frameId, newStoryId }` | take one frame out of a thread of two or more; the thread closes up and the frame gets a new empty story. |

Why the text rules: the model knows no layout, so it cannot cut a story where one frame ends. Joining appends, breaking keeps
everything in front, and nothing else ever moves text between stories. `threadPosition(doc, frameId)` gives
`{ story, index, prev, next }`; `threadFrames(doc, storyId)` the frames in order.

Until the thread engine (P2-02) lays a story out, `PageView` shows the **whole** story in the first frame of its thread and
nothing in the others. The engine replaces `TextFrameView`'s single box with one slot per frame; the story `doc` stays the
source of truth, exactly as in `spikes/threading`, and the engine's `Slot` list is derived from `frameIds` plus each frame's
box, inset and (P2-09) the wraps of the other frames.

## Text wrap (stored now, used in P2-09)

`frame.textWrap` is optional on every box frame (rect, ellipse, line, text, image), absent meaning none:

```
{ mode: 'none' }
{ mode: 'boundingBox', offsets: { top, right, bottom, left } }   // points, text stays outside the rotated bounding box + offsets
{ mode: 'contour', offset }                                      // outline + one offset; only an ellipse has a contour for now
```

`setFrameProps { props: { textWrap } }` sets it (`null` or `{ mode: 'none' }` removes the field, so there is one stored form of
"none"). Wrap is one-sided for now (spike caveat 10). `wrapOf(frame)` returns the effective wrap.

## Baseline grid

`document.baselineGrid = { start, increment }` in points; `start` is the distance from the top of each page's trim box to the
first grid line (default 0), `increment` is above zero (default 12). `doc.setBaselineGrid` changes it. The view toggle and the
per-paragraph `alignToBaselineGrid` are P2-08.

## Versioning and migration

`FORMAT_VERSION` is 2 for both `document.json` and `links.json` (links.json did not change; only its number moves). `parseDocument`
runs `migrations[n]` in order until the file is current, on raw JSON before schema validation, so opening a v1 package needs
no user action; the file on disk stays v1 until it is saved (the app does not mark a migrated document dirty). A file with a
higher version is refused ("saved by a newer version of Galley").

`migrations[1]` (`migrateV1ToV2`) keeps the look of the page exactly:

| v1 | v2 |
|---|---|
| `story.defaults` | one paragraph style per distinct set of defaults, based on `[Basic Paragraph]`, every v1 property set explicitly; defaults equal to `[Basic Paragraph]`'s use it and add no style. Created in story-id order as `imported-1`, `imported-2`, ... named by what they set (`Inter ExtraBold 160/168`; a repeat gets ` (2)`). |
| each paragraph | `attrs: { style }`, no overrides |
| `strong` / `em` run | `override` mark with weight `bolder(default)` and / or `fontStyle: italic`; no mark when that changes nothing; neighbours merge |
| one story per frame | `story.frameIds = [frame]` (all text frames naming the story, sorted by id) |
| (nothing) | `baselineGrid { 0, 12 }`, `[Basic Paragraph]`, `[None]`, empty `textWrap` |

`fixtures/v1/*.galley` (poster-basic, swatch-chart, typography-marks) are frozen v1 documents: **never regenerate them**. They are
the migration inputs. `packages/model/test/migration.test.ts` checks that every paragraph and run resolves to what v1 drew,
`packages/render/test/migration.test.tsx` that the CSS equals what the v1 renderer emitted, and
`apps/desktop/e2e/text/migration.e2e.ts` that the page renders **pixel for pixel** like the baselines captured from the Phase 1
build (`e2e/__screenshots__/text/migration.e2e.ts/`, zero differing pixels allowed).

To add v3: bump `FORMAT_VERSION`, add `migrations[2]` and a `linkMigrations[2]`, freeze a v2 copy of each fixture under
`fixtures/v2/`, and extend the migration tests to run every frozen version.

## The style-to-CSS resolver (`packages/render/src/styles/resolve.ts`)

`paragraphCss(resolved, colors, { dropSpaceBefore })` and `runCss(paragraph, run, colors)` return React-style CSS objects (`toCssText`
for text). Contract: print and shared layers only; a paragraph's CSS is complete on its own `<p>` (nothing is inherited from the
frame box); a run gets only what differs from its paragraph; neutral values emit nothing, so a migrated v1 document gets
exactly the declarations the Phase 1 renderer put on the frame (family, weight, style, size, line height, letter spacing, text
align, color); colors come only from the `ColorResolver`. Not emitted yet (lane S extends the file): drop caps (`::first-letter`
needs a generated stylesheet), `alignToBaselineGrid` (P2-08), continued-paragraph rules (P2-02).

## Decisions

1. **Style ids, not values, in stories.** A paragraph holds `style` and optional overrides; resolving is the only way to get a look.
2. **Overrides use the same three layers as styles**, so one merge function serves chains and overrides, and a future web ruleset
   can override too. The cost is nesting in the JSON (`{ "shared": { ... } }`).
3. **Two mark types, absolute weights.** See "How v1 bold and italic map".
4. **`basedOn: null` means based on nothing**, uniformly; `[Basic Paragraph]` is an ordinary (protected) style.
5. **The model has no layout.** Thread commands only change membership; text never splits itself.
6. **Wrap and the baseline grid are plain data.** Stored and validated now so P2-08 and P2-09 add behavior, not format.
7. **Resolved paragraph CSS lives on `<p>`**, which is what lets the thread engine measure a slot that starts mid-story.
8. **Migrating is lossless for rendering and tested to the pixel.**

## What lanes S, N and T build on

* **S (styles and type controls)**: all style and formatting commands above exist; the panels call them. A property goes into
  the schema in `props.ts` first (the layer decides the tab), then into `resolveParagraph`'s output automatically, then
  `styles/resolve.ts`. `ResolvedParagraph` already has every property P2-05 lists. Do not read `Story.defaults` (gone).
* **N (fonts)**: the faces a document needs are the `(fontFamily, fontWeight, fontStyle)` of every resolved paragraph and run;
  `usedFontFaces` in `packages/render/src/fontLoading.ts` already computes them. Weights are absolute numbers.
* **T (thread engine and editor)**: a ProseMirror schema for the story is `doc: paragraph+`, `paragraph` with attrs `style`
  (default `basic-paragraph`) and `overrides` (default null) plus the engine's view-only `cont` and `tail`, `text`, and two marks
  in this order: `charStyle` (attr `style`) and `override` (attrs `shared`, `print`, `web`, default null). Store with
  `normalizeStoryDoc(view.toJSON())` and `story.setDoc`, or use the range commands. The engine's paragraph metrics (`styleOf`) become
  `resolveParagraph(doc, paragraphAttrs(node))`.

## Not in the model yet

Next-style, keep options and widow/orphan control, tab stops, bullets and numbering, nested styles, text-frame columns and
vertical justification, auto leading, drop-cap CSS, tracked changes. Each is additive (a new optional property or field).
