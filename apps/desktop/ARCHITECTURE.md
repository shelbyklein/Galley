# Galley desktop: architecture

How the pieces fit, and where each lane works. Read this before touching a shared file. The plan is in
`docs/plans/phases-1-2.md`; this file describes what exists.

## Layout and ownership

```
packages/
  model/       @galley/model     document schema, commands, undo/redo, serialization, sentinels. No DOM.
  render/      @galley/render    the page renderer (React), color modes. Used by the editor AND the export page.
  prepress/    @galley/prepress  PDF post-processor (empty until lane A, P1-05)
apps/desktop/
  src/main/               Electron main process                      lane C (export/ lane A, fonts/ lane N)
  src/preload/            contextBridge API (`window.galley`)         lane C
  src/shared/             types shared by main, preload, renderer
  src/renderer/           the editor window
    store/                zustand store: document + history + UI      shared (minimal changes)
    commands/             command registry, shortcuts, core commands   shared (registry.ts)
    shell/                title bar, control strip, tools, dock, menus lane C
    canvas/               pasteboard, viewport, overlay                lane B
    tools/                the tools                                    lane B
    panels/ dialogs/      Pages, Layers, Swatches; New Document        lane C
  src/export-page/        the hidden export window's page              lane A
  e2e/                    Playwright specs (e2e/<area>/*.e2e.ts)       per lane; helpers/ shared
fixtures/                 poster-basic.galley (opened in dev), golden/ lane A
scripts/                  fixtures/ (builders), placeholder.mjs
```

The one rule behind the layout: **the editor and the exporter draw pages with the same component** (`PageView` in
`@galley/render`). Editor chrome (selection, handles, guides, rulers) lives in the canvas overlay, above the page, so
exported pages contain only the page. A unit test (`src/entries.test.ts`) enforces that both entries import
`@galley/render` and that neither draws shapes itself.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | electron-vite dev server with HMR; opens `fixtures/poster-basic.galley` (temporary) |
| `npm run build` | typecheck all workspaces, then `electron-vite build` into `apps/desktop/out/` |
| `npm test` | Vitest across all workspaces (`vitest.config.ts` projects); one workspace: `npm test -w @galley/model` |
| `npm run test:e2e` | builds, then runs Playwright against the built app |
| `npm run test:milestone1` | builds, then runs the Milestone 1 journey (`e2e/milestone/`, own Playwright config): builds the poster through the UI, saves, reopens and exports it, and measures the PDF. Screenshots to `apps/desktop/test-results/milestone1/` |
| `npm run test:golden` / `test:text` / `test:geometry` | placeholders that print "not yet implemented"; lanes A and T fill them in |
| `npm run fixtures` | regenerates `fixtures/poster-basic.galley/{document,links}.json` from `scripts/fixtures/poster-basic.ts` |
| `npm run typecheck` | `tsc --noEmit` in every workspace |

Electron is pinned to exactly `44.5.1` (root `package.json`). Electron 44 downloads its binary lazily on first
`require('electron')`, so there is no postinstall to approve; the `allowScripts` entries cover esbuild.
`printToPDF` margins in Electron 44's typings are `{ top, bottom, left, right }` in inches (the spike's
`marginType: 'none'` is not in the typings): use zeros.

## The model (`@galley/model`)

Plain data, points everywhere, objects in flat records keyed by id (`frames`, `stories`, `swatches`, ...), ordering in
explicit arrays (`pageOrder`, `layerOrder`, `swatchOrder`, `page.items`, `group.childIds`). The header of
`packages/model/src/schema.ts` is the reference for the shape, stacking order and geometry conventions. Highlights:

- A frame's `x`, `y` are the top-left of its unrotated box relative to its page's trim box; `rotation` is degrees about
  the center. Groups have no geometry; use `boundsOf(doc, id)`.
- Paints are `{ swatchId, tint, overprint }`; `null` is [None]. Text color lives on the story's `defaults` until Phase 2.
- Text frames are story-backed: `frame.storyId` -> `doc.stories[id]` = ProseMirror JSON + default style.
- `serializeDocument(doc)` gives canonical text (sorted keys). Compare documents with it, never with `JSON.stringify`
  (key order depends on edit history). It splits image links into `links.json`.
- `@galley/model/sentinels` assigns each ink a sentinel RGB; renderer export mode and prepress both call
  `buildSentinelTable(doc)` and get the same table.

### How to add a model command

1. Write it in the right file under `packages/model/src/commands/` with `defineCommand(name, undoLabel, run)`.
   `run(draft, args)` mutates an Immer draft. Validate first, then mutate, and reject with `fail('message')` (throws
   `CommandError`; the document is left untouched). Ids come in through `args`, never generated inside. Copy objects
   from `args` into the draft with `own(...)` (Immer freezes what it stores). Read-only lookups (`parentOf`,
   `subtreeIds`) go through `baseOf(draft)`, taken before the first write.
2. Export it from `commands/index.ts` **and add it to `allCommands`**.
3. Add a generator for it in `packages/model/test/random-commands.ts`. The random-sequence test
   (`test/random.test.ts`: 600 random command sequences, undo-all then redo-all, validity after every step) fails if a
   command in `allCommands` has no generator or is never applied successfully.
4. Add a focused unit test for its rules in `test/commands.test.ts`.
5. Use it from the app: `useEditorStore.getState().dispatch(myCommand, args)`.

### Undo steps

`dispatch` is one undo step. A gesture is one step through a transaction:

```ts
const s = useEditorStore.getState();
s.beginTransaction('Move');                       // pointer down
for (const move of pointerMoves) s.dispatch(moveFrames, { ids, dx, dy });   // document updates live
s.commitTransaction();                            // pointer up: exactly one undo step. Escape: s.cancelTransaction()
```

Repeated keyed changes merge too: `dispatch(cmd, args, { coalesceKey: 'inspector-x' })`. Call `closeCoalescing()` on
blur or save. A change with no effect leaves no undo step.

## The store (`renderer/store`)

One zustand store (`useEditorStore`; `createEditorStore()` for isolated tests). Slices:

| Slice | State | Actions | In undo history? |
|---|---|---|---|
| document | `history` (current doc, past, future), `savedRevision` | `dispatch`, `begin/commit/cancelTransaction`, `closeCoalescing`, `undo`, `redo`, `openDocument`, `markSaved` | yes, that is the history |
| selection | `selection: Id[]`, `currentPageId` | `setSelection`, `toggleSelection`, `clearSelection`, `setCurrentPage` | no |
| viewport | `viewport { zoom, panX, panY, fit }` (zoom = CSS px per pt, 1 = 100%) | `setViewport` | no |
| tool | `activeTool: ToolId` | `setActiveTool` | no |

Selectors: `selectDoc`, `selectCanUndo`, `selectCanRedo`, `selectUndoLabel`, `selectRedoLabel`, `selectIsDirty`,
`selectCurrentPage`. Components read with `useEditorStore(selector)`; event handlers and commands use
`useEditorStore.getState()`. After any document change the store drops selected ids that no longer exist. Undo does
not restore selection, viewport or tool. Add a slice by adding fields and actions to `createEditorState`, keeping it
independent of the others; never put UI state inside `history`.

## The command registry (`renderer/commands/registry.ts`)

Everything the user can do is a `Command { id, label, category?, shortcut?, run, enabled? }` registered once:

```ts
commands.register({ id: 'tool.rectangle', label: 'Rectangle', category: 'Tools', shortcut: 'M',
                    run: () => useEditorStore.getState().setActiveTool('rectangle') });
```

- Lane B registers tool and edit commands (`tool.*`, `object.group`, `object.arrange.*`).
- Lane C builds the menu bar from `commands.byCategory('Edit')` etc. (`formatShortcut` for display, `toAccelerator`
  for Electron menus) and refreshes on `commands.subscribe` and store changes (`enabled()` is polled).
- `installKeyboardShortcuts()` (called in `renderer/main.tsx`) runs the command bound to a key. Single-key shortcuts
  are ignored while an input has focus. If lane C moves shortcuts to native menu accelerators, uninstall the handler
  for those keys so nothing fires twice.
- Ids are dotted lower case and unique; registering a duplicate throws. Core commands (`edit.undo`, `edit.redo`) are in
  `commands/core.ts`.
- Shortcut strings: `Mod+Shift+Z`, `V`, `Mod+]`, `Space`, `Alt+ArrowUp`. `Mod` is Command on macOS.

## The renderer API (`@galley/render`)

```tsx
import '@galley/render/fonts';                  // once per window: the built-in Inter faces (static weights)
import { PageView } from '@galley/render';

<PageView doc={doc} pageId={id} colorMode="screen" | "export"
          assetUrl={(asset) => assetUrl(asset.path)}      // galley-asset://pkg/<path>, served by the main process
          softProof={fn?} resolver={ColorResolver?} />    // screen mode only; lane A plugs real soft proofing in here
```

- One page at a time, 1 pt = 1 CSS `pt` (1.333 px). Zoom with a CSS `transform` on a wrapper, never by changing sizes
  (the canvas placeholder shows how: `scale(zoom * 0.75)` makes zoom = CSS px per pt).
- The sheet is trim plus `max(bleed, slug)` per side (`sheetGeometry(page)`), always clipped (`overflow: hidden`).
- Paint order: layers bottom to top, then `page.items` order, groups expanded in place. Hidden layers are skipped.
  Shapes are SVG layers at the sheet origin (exact geometry); text and image frames are HTML boxes between them
  (`htmlFrameStyle` is the one place lane A may change how those are positioned, P1-04). Positions are `left`/`top` in pt.
- Text: each story's default style (family, weight, size, leading, tracking, align, color) on the frame box, paragraphs as
  `<p>`, `strong`/`em` marks. Static in Phase 1; lane T replaces the single box with threaded slots.
- **Color modes.** `screen`: paper on the trim box; colors via the temporary naive CMYK to RGB (replaced by P1-07).
  `export`: no paper, no chrome, no empty-frame marks, and every document color is a sentinel RGB from
  `buildSentinelTable(doc)`. Colors only ever come from the `ColorResolver`; `page.css` contains no colors (a test
  checks it). `findNonSentinelColors(root, table)` audits any rendered DOM.
- `data-ready="true"` on `.galley-page` appears once the fonts and images the page uses are loaded. Wait for it before
  printing or taking screenshots (`waitForStable` in the e2e helpers does).
- Elements carry `data-frame-id`, which tests use to find a frame in the DOM.

### The export page (`src/export-page`)

A separate renderer entry that imports `@galley/render` and nothing from the editor. It exposes
`window.galleyExport.load(files, pageId?)`, which parses the document, renders the page in export mode, waits until it is
ready and returns `{ pageId, sheet, sentinels }`, and `window.galleyExport.audit()`. It sets `@page { size }` to the
sheet. Lane A's export command opens it in a hidden window and prints it. `e2e/foundation/export-page.e2e.ts` shows the
whole flow, including `printToPDF`.

## Documents, files, menus and the shell (lane C)

**Packages.** `X.galley/` holds `document.json`, `links.json`, `assets/` (and `fonts/` from Phase 2). `src/main/packageIO.ts`
reads and writes them (atomic writes; Save As to a new place copies the linked images and `fonts/`); `recents.ts` keeps the
recent-files list in the user-data folder; `files.ts` registers the IPC handlers (the Open and Save As panels, the
Save / Don't Save / Cancel prompt). The renderer parses and serializes with `@galley/model`
(`renderer/shell/files/documentActions.ts`: new, open, save, save as, close, `confirmUnsavedChanges`). One document per
window: New and Open replace it after the prompt, and Close (Cmd-W) closes the window.

**Startup document.** `--open <path>`, else `$GALLEY_OPEN` (the e2e hook), else (only under `npm run dev`)
`fixtures/poster-basic.galley`. It is a launch hook: it is opened but not added to the recent files. With nothing to open
the store holds a blank Letter document.

**The active package** (`src/main/package.ts`) is the folder `galley-asset://pkg/<relative path>?v=<n>` serves. A saved or
opened document: its `X.galley` folder. A never-saved document: a scratch package in the OS temp folder, created by
`ensureActivePackage()` the first time something needs a place for an image (lane B's place-image handler calls it and
copies the picked file into `<dir>/assets/`); Save As copies the images into the real package and deletes the scratch.
`getActivePackage()` and `getMissingLinks()` are for other main-process code (lane A's export must refuse to print while
links are missing: the protocol serves a placeholder SVG for a missing file, which would otherwise be printed).
`bumpAssetGeneration()` (`shared/assets.ts`) changes every image URL when a package is opened, so an `<img>` never keeps
the previous document's picture.

**Window state and closing.** The renderer reports `{ dirty, title, path }` to the main process (`setDocumentState`); main
sets the dirty dot and, on a close with unsaved changes, asks the renderer to run the prompt (`closeRequested`), which
ends in `files.closeWindow()` or `files.cancelClose()`. e2e runs use a fresh temp user-data folder unless
`GALLEY_USER_DATA` is set.

**Menus** (`renderer/shell/menu/`). The command registry is the source of truth. `menuSpec.ts` describes the menu bar
(File, Edit, Object, Type, View, Window) from it; `menuBridge.ts` sends the description to the main process
(`setMenu`), which builds the native `Menu` (`src/main/menu.ts`), and runs `commands.execute(id)` when an item is
clicked. An id that is not registered is shown disabled; a registered command in a menu's `category` that the table does
not list is appended to that menu. Native accelerators are set only for shortcuts with Cmd/Ctrl (or a function key),
because a bare-key accelerator would swallow typing; the window's key handler (`commands/keyboard.ts`) is still what runs
every shortcut, and the bridge drops a second run of the same command within 200 ms (accelerator and key handler both
firing). Edit commands (undo, cut, copy, paste, select all) edit the text of a focused field instead. A modal dialog
blocks shortcuts. Tests read and click the native menu through the main process (`e2e/shell/helpers.ts`).

**The shell** (`renderer/shell/`, `panels/`, `dialogs/`). `shellStore.ts` holds UI state that is not the document and not
shared with other lanes: which panels are shown and collapsed (remembered), the fill/stroke proxy target, the control
strip's reference point and linked proportions, the open package path, broken links, recent files, notices and the
open dialog. The one piece of lane C state other lanes need is in the editor store: `activeLayerId` (the layer new
objects go on). The Layers panel sets it, it follows the selection, and the store keeps it a layer that exists. Docked panels are built on `panels/Panel.tsx` and listed in `shell/Dock.tsx`. Icons are SVG
files in `shell/icons/` used as CSS masks (`shell/Icon.tsx`); renderer code contains no shape markup. Frames on a hidden
or locked layer cannot be selected: `store/selectable.ts` filters the selection in the store, so every way of selecting
obeys it. The control strip's geometry (reference point, X/Y/W/H, rotation) is in `shell/control-strip/transform.ts`;
X and Y are the position of the reference point on the rotated box, and W, H and rotation hold it in place.

## End-to-end tests

Specs are `apps/desktop/e2e/<area>/*.e2e.ts`; they drive the **built** app (`apps/desktop/out`, so `npm run test:e2e`
builds first). Never import app code into a spec; they run in Node and talk to the app through Playwright.

```ts
import { test, expect } from '../helpers/fixtures';
import { FIXTURES } from '../helpers/launch';
import { getDocument, getEditorState, runCommand } from '../helpers/app-state';
import { snap, expectBaseline } from '../helpers/screenshot';

test.use({ open: FIXTURES.posterBasic });            // or null for a blank document

test('...', async ({ galley }, testInfo) => {
  const { page, app } = galley;                      // page = the editor window, app = ElectronApplication
  await page.keyboard.press('Meta+z');
  expect((await getEditorState(page)).undoSteps).toBe(0);
  await snap(page, 'my-step', { testInfo });         // test-results/screens/my-step.png: open it and LOOK at it
  await expectBaseline(page, 'my-step');             // e2e/__screenshots__/<spec>/my-step.png
});
```

- `launchApp` starts Electron with `GALLEY_E2E=1` (fixed device scale factor 1, so screenshots do not depend on the
  display) and the window at 1440 x 900 content size.
- In e2e runs the renderer exposes `window.__galley = { store, commands, model }`. The `app-state` helpers wrap it:
  `getDocument(page)` (canonical document JSON), `getEditorState(page)`, `runCommand(page, id)`. Assert on the model, not
  just on pixels. "Undo restores the document byte for byte" means equal `getDocumentJson(page)` strings.
- `snap` always writes a PNG you can open; `expectBaseline` compares with the committed baseline
  (`maxDiffPixelRatio` 0.002). Create or update baselines with
  `npm run test:e2e -w @galley/desktop -- --update-snapshots`, and inspect every new baseline by eye before committing it.
- `waitForStable(page)` (called by both) waits for `.galley-page[data-ready="true"]`, fonts, image decode and two frames.
- To test the export page, create a hidden `BrowserWindow` through `app.evaluate` (see `export-page.e2e.ts`).
- Playwright runs one worker; windows show on screen while tests run.
- **Milestone journeys** (`e2e/milestone/*.milestone.ts`, `npm run test:milestone1`) are long end-to-end scripts with their own
  config (`playwright.milestone.config.ts`), so `test:e2e` does not run them. `milestone1.milestone.ts` builds the Phase 1
  poster through the UI (⌘N dialog, Swatches panel, tool buttons and pointer drags, typing in text frames, control-strip
  fields, ⌘D with a stubbed file dialog), saves, closes, relaunches and reopens it, exports it, and measures the PDF with
  `scripts/milestone1/check-poster.ts` (the golden suite plus its own plate measurements). Inspection screenshots go to
  `apps/desktop/test-results/milestone1/` (a default `test:e2e` run clears `test-results/`, so look at them before it).
  `shotWhileDragging` takes a screenshot with the pointer button held: Playwright's `page.screenshot` resizes the page and
  Chromium answers with a synthetic pointer move that drags the gesture elsewhere.

## Fixtures

`fixtures/poster-basic.galley/` is the Phase 1 mockup poster: Tabloid with 0.125 in bleed and 0.5 in slug, an orange
CMYK block into the bleed, a Studio Blue CMYK headline, 100K black body text, a PANTONE 185 C spot ellipse with
[Paper] text, and a generated photo (`scripts/fixtures/generate-photo.ts`, procedural, no third-party image). Its text
frames sit at multiples of 3 pt with leadings that are multiples of 0.75 pt. Regenerate with `npm run fixtures`;
`packages/model/test/fixture.test.ts` fails if the committed files drift from the builder.

## Fonts

Inter (SIL OFL) from `@fontsource/inter`, static weights 400/700/800/900 and italics, so printed text embeds as real
TrueType. No system or Adobe font and no ICC profile is committed. Phase 2 adds the font manager.
