// npm run test:golden: export the golden fixtures through the app's own pipeline (hidden window, printToPDF, prepress), then
// measure the PDFs: Ghostscript `tiffsep` plates, qpdf --check, boxes, PDF/X-4 plumbing, RGB leftovers (P1-05).
// Exits non-zero when any check fails. The PDFs, plates and a preview of each stay under build/golden/ (gitignored).
import { parseDocument, type DocumentFiles } from '@galley/model';
import { formatChecks, measureRegion, runGoldenChecks, separate, type Check } from '@galley/prepress/verify';
import { exportPage, pageBoxes } from '@galley/prepress';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { buildApp, exportToFile, FIXTURES_DIR, launchGalley, readPackage, REPO_ROOT } from './lib/app';

interface Case {
  id: string;
  /** The `.galley` package. */
  dir: string;
  options: { bleed: boolean; marks: boolean };
  /** The frame whose text must be K only in the unprocessed Chromium PDF's negative control (the baseline that shows the checks bite). */
  negativeControlFrame?: string;
}

const CASES: Case[] = [
  { id: 'poster-basic', dir: path.join(FIXTURES_DIR, 'poster-basic.galley'), options: { bleed: true, marks: true }, negativeControlFrame: 'body' },
  { id: 'swatch-chart', dir: path.join(FIXTURES_DIR, 'golden/swatch-chart.galley'), options: { bleed: true, marks: true }, negativeControlFrame: 'body-1' },
  { id: 'swatch-chart-bleed-only', dir: path.join(FIXTURES_DIR, 'golden/swatch-chart.galley'), options: { bleed: true, marks: false } },
  { id: 'swatch-chart-trim-only', dir: path.join(FIXTURES_DIR, 'golden/swatch-chart.galley'), options: { bleed: false, marks: true } },
  { id: 'swatch-chart-bare', dir: path.join(FIXTURES_DIR, 'golden/swatch-chart.galley'), options: { bleed: false, marks: false } },
];

const OUT = path.join(REPO_ROOT, 'build/golden');

function tool(cmd: string, args: string[]): string {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.split('\n')[0]!.trim() : `MISSING (${cmd})`;
}

async function runCase(c: Case): Promise<Check[]> {
  const files: DocumentFiles = readPackage(c.dir);
  const doc = parseDocument(files);
  const outDir = path.join(OUT, c.id);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const pdf = path.join(outDir, `${c.id}.pdf`);
  const raw = path.join(outDir, `${c.id}.chromium.pdf`);

  const app = await launchGalley({ open: c.dir });
  let run;
  try {
    run = await exportToFile(app, { files, options: c.options, title: doc.meta.title }, pdf, raw);
  } finally {
    await app.close();
  }
  spawnSync('pdftoppm', ['-png', '-r', '60', '-singlefile', pdf, path.join(outDir, 'preview')]);

  const checks = await runGoldenChecks({ pdfPath: pdf, doc, options: c.options, workDir: outDir, photoReference: { chromiumPdfPath: raw, outputProfilePath: run.profile.path } });
  checks.push({ group: 'export', name: 'the export reported no warnings', expected: '(none)', measured: run.warnings.join(' | ') || '(none)', pass: run.warnings.length === 0 });
  checks.push({ group: 'export', name: 'prepress converted every color: no unmatched or unhandled RGB', expected: '0', measured: `${run.report.unmatched.length} unmatched, ${run.report.unhandled.length} unhandled, ${run.report.shadings.unsupported.length} unsupported gradient stops`, pass: run.report.unmatched.length + run.report.unhandled.length + run.report.shadings.unsupported.length === 0 });

  if (c.negativeControlFrame) {
    // The baseline of the spike: the unprocessed Chromium PDF (sentinel RGB) through Ghostscript is NOT K only, so a
    // K-only check can fail, and the passing result above means something.
    const page = exportPage(doc.pages[doc.pageOrder[0]!]!, c.options);
    const frame = doc.frames[c.negativeControlFrame] as unknown as { x: number; y: number; w: number; h: number };
    const boxes = pageBoxes(page);
    const seps = await separate(raw, path.join(outDir, 'sep-chromium'));
    const m = measureRegion(seps, { x: (boxes.trim.x + frame.x) * seps.scale, y: (boxes.trim.y + frame.y) * seps.scale, w: frame.w * seps.scale, h: frame.h * seps.scale });
    const rgbInk = m.max.C + m.max.M + m.max.Y;
    checks.push({ group: 'negative control', name: `the unprocessed Chromium PDF is NOT K only in "${c.negativeControlFrame}" (so the K-only check can fail)`, expected: 'C/M/Y > 0', measured: `max C${m.max.C.toFixed(1)} M${m.max.M.toFixed(1)} Y${m.max.Y.toFixed(1)}`, pass: rgbInk > 0 });
  }
  return checks;
}

async function main(): Promise<void> {
  console.log(`# Galley golden separations (gs ${tool('gs', ['--version'])}, qpdf ${tool('qpdf', ['--version'])}, ${tool('pdftoppm', ['-v'])})`);
  for (const t of ['gs', 'qpdf', 'pdffonts', 'pdftoppm']) {
    if (spawnSync(t, ['--version']).error && spawnSync(t, ['-v']).error) throw new Error(`${t} is required (brew install ghostscript qpdf poppler)`);
  }
  console.log('Building the app...');
  buildApp();
  let failed = 0;
  let total = 0;
  for (const c of CASES) {
    const t0 = Date.now();
    const checks = await runCase(c);
    const bad = checks.filter((x) => !x.pass);
    failed += bad.length;
    total += checks.length;
    console.log(`\n## ${c.id}  (bleed ${c.options.bleed ? 'on' : 'off'}, marks ${c.options.marks ? 'on' : 'off'})  ${checks.length - bad.length}/${checks.length} checks passed, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    console.log(formatChecks(bad.length > 0 || process.env.GOLDEN_VERBOSE ? checks : checks.filter((x) => x.group === 'structure' && x.name.startsWith('qpdf') ? true : false)));
    if (bad.length === 0 && !process.env.GOLDEN_VERBOSE) console.log(`  (all ${checks.length} checks passed; GOLDEN_VERBOSE=1 lists them; the PDF and its plates are in build/golden/${c.id}/)`);
  }
  console.log(`\nGolden: ${total - failed}/${total} checks passed${failed ? `, ${failed} FAILED` : ''}`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
