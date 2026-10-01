// Dialogs module (lane C owns apps/desktop/src/renderer/dialogs/**): New Document and the swatch dialog. The unsaved-changes
// prompt and the Open / Save As panels are native (src/main/files.ts).
// Lane N adds dialogs/export/ (export options and the font warnings).
export { DialogHost } from './DialogHost';
export { PAGE_PRESETS, pageFromSpec, type NewDocumentSpec } from './presets';
