// Prints HTML pages to PDF with Electron's printToPDF, the way the export does (zero margins, CSS page size, backgrounds on).
// Used by the geometry lab (scripts/geometry/lab.ts) to compare ways of placing things. Run through
// `electron scripts/geometry/lab-print.cjs <jobs.json>`, where jobs.json is [{ "html": "<path>", "pdf": "<path>" }, ...].
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');

app.dock && app.dock.hide();
app.disableHardwareAcceleration();

app
  .whenReady()
  .then(async () => {
    const jobs = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
    const win = new BrowserWindow({ show: false, width: 900, height: 900 });
    for (const job of jobs) {
      await win.loadFile(job.html);
      await win.webContents.executeJavaScript('document.fonts.ready.then(() => Promise.all([...document.images].map((i) => i.decode().catch(() => 0))))');
      const pdf = await win.webContents.printToPDF({ preferCSSPageSize: true, printBackground: true, margins: { top: 0, bottom: 0, left: 0, right: 0 }, scale: 1 });
      fs.writeFileSync(job.pdf, pdf);
    }
    app.quit();
  })
  .catch((e) => {
    console.error(e);
    app.exit(1);
  });
