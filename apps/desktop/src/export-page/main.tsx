// Export page entry (lane A owns apps/desktop/src/export-page/**). Loaded in the hidden export window; the page is
// rendered by @galley/render in export mode and printed with printToPDF. Replaced by the real entry in P1-03.
document.getElementById('root')!.textContent = 'export page';
