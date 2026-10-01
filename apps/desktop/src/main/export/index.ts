// Export orchestrator (lane A owns apps/desktop/src/main/export/**): File > Export > PDF/X-4 runs a hidden window on
// src/export-page, calls window.galleyExport.load(...), runs webContents.printToPDF, then the @galley/prepress
// post-processor, then saves. P1-06 builds it. Nothing here yet.
export {};
