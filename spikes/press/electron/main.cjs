// Electron export step: render the page in export mode (sentinel colours) and printToPDF.
// Usage: electron electron/main.cjs [--mode=export|screen]
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { assignSentinels } = require('../src/sentinel.cjs');

const root = path.resolve(__dirname, '..');
const build = path.join(root, 'build');
const modeArg = process.argv.find((a) => a.startsWith('--mode='));
const mode = modeArg ? modeArg.split('=')[1] : 'export';
// experiments: --page=experiments/x.html --out=build/x.pdf prints an arbitrary page with the same printToPDF options
const argv = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const expPage = argv('page');
const expOut = argv('out');

app.dock && app.dock.hide();
app.disableHardwareAcceleration();

async function runExperiment() {
  const win = new BrowserWindow({ show: false, width: 912, height: 1152 });
  await win.loadFile(path.resolve(root, expPage));
  await win.webContents.executeJavaScript('document.fonts.ready.then(() => 1)');
  const pdf = await win.webContents.printToPDF({ preferCSSPageSize: true, printBackground: true, margins: { marginType: 'none' }, scale: 1 });
  fs.mkdirSync(path.dirname(path.resolve(root, expOut)), { recursive: true });
  fs.writeFileSync(path.resolve(root, expOut), pdf);
  console.log(`experiment ${expPage} -> ${expOut} (${pdf.length} bytes)`);
}

async function main() {
  if (expPage) return runExperiment();
  fs.mkdirSync(build, { recursive: true });
  const { swatches } = JSON.parse(fs.readFileSync(path.join(root, 'swatches.json'), 'utf8'));
  const table = assignSentinels(swatches);

  // theme.css: one custom property per paint. Export mode uses the sentinel RGB.
  const css = table
    .map((e) => {
      const [r, g, b] = mode === 'export' ? e.rgb : e.proofRGB;
      return `  --sw-${e.id}: rgb(${r} ${g} ${b});`;
    })
    .join('\n');
  fs.writeFileSync(path.join(build, 'theme.css'), `/* generated, mode=${mode} */\n:root {\n${css}\n}\n`);
  if (mode === 'export') {
    fs.writeFileSync(path.join(build, 'sentinels.json'), JSON.stringify(table, null, 2));
  }

  const win = new BrowserWindow({ show: false, width: 912, height: 1152, webPreferences: { offscreen: false, backgroundThrottling: false } });
  await win.loadFile(path.join(root, 'page', 'index.html'), { query: { mode } });

  // wait for web fonts and image decode, then collect element boxes for the verifier
  const info = await win.webContents.executeJavaScript(`(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((i) => i.decode()));
    const sheet = document.getElementById('sheet').getBoundingClientRect();
    const regions = {};
    for (const el of document.querySelectorAll('[data-region]')) {
      const r = el.getBoundingClientRect();
      regions[el.dataset.region] = { x: r.left - sheet.left, y: r.top - sheet.top, w: r.width, h: r.height };
    }
    const faces = [...document.fonts].map((f) => ({ family: f.family, weight: f.weight, status: f.status }));
    return { regions, faces, sheet: { w: sheet.width, h: sheet.height }, ua: navigator.userAgent };
  })()`);
  fs.writeFileSync(path.join(build, 'regions.json'), JSON.stringify(info, null, 2));
  console.log('fonts:', JSON.stringify(info.faces));
  console.log('sheet px:', info.sheet.w, 'x', info.sheet.h, '|', info.ua);

  if (mode === 'screen') {
    // soft-proof render of the same page: a PNG of what the editor shows, plus a PDF made the "naive" way
    // (real RGB swatches, no sentinels) which the verifier uses as the Ghostscript-conversion baseline.
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(build, 'screen.png'), img.toPNG());
    console.log('wrote build/screen.png');
  }

  const pdf = await win.webContents.printToPDF({
    preferCSSPageSize: true,
    printBackground: true,
    margins: { marginType: 'none' },
    scale: 1,
    landscape: false,
    generateTaggedPDF: false,
    generateDocumentOutline: false,
  });
  const outPath = path.join(build, mode === 'export' ? 'chromium.pdf' : 'screen-mode.pdf');
  fs.writeFileSync(outPath, pdf);
  console.log(`wrote ${path.relative(root, outPath)} (${pdf.length} bytes), electron ${process.versions.electron}, chromium ${process.versions.chrome}`);
}

app.whenReady().then(main).then(() => app.quit()).catch((e) => { console.error('EXPORT FAILED', e); app.exit(1); });
