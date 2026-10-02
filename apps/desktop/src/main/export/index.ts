// Export orchestrator (lane A owns apps/desktop/src/main/export/**): File > Export > PDF/X-4 runs a hidden window on
// src/export-page (render.ts), prints it with printToPDF, runs the @galley/prepress post-processor (pipeline.ts) and saves
// (handlers.ts). softproof.ts serves the editor's soft-proof colors and the profile name for the status bar.
export { registerExportHandlers } from './handlers';
export { runExportPipeline, type ExportPipelineRequest, type ExportPipelineResult } from './pipeline';
