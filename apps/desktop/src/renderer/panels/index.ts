// Panels module (lane C owns apps/desktop/src/renderer/panels/**): Pages, Layers, Swatches (Phase 1), then the
// Paragraph Styles, Character Styles, Text Wrap panels that lanes S and T add in their own subfolders.
// To add a docked panel, build it on `Panel` and list it in shell/Dock.tsx.
export { LayersPanel } from './LayersPanel';
export { Panel } from './Panel';
export { PagesPanel } from './PagesPanel';
export { SwatchesPanel } from './SwatchesPanel';
