// npm run test:geometry: exact PDF geometry for shapes and text-frame origins (P1-04).
//   1. the lab: the candidate placement methods, measured in printToPDF output (the chosen one is asserted)
//   2. the page-size rule: what Chromium does to the page size, and why the export asks for a whole point more
//   3. the real renderer: a fractional-position document through the app's own export pipeline
// Exits non-zero when an asserted row fails. The numbers are recorded in packages/render/GEOMETRY.md.
import { buildApp } from '../golden/lib/app';
import { runLab, runPageSize, type Row } from './lab';
import { runReal } from './real';

function print(rows: Row[]): void {
  let section = '';
  for (const r of rows) {
    if (r.section !== section) {
      section = r.section;
      console.log(`\n## ${section}`);
    }
    const tag = r.pass === null ? 'info' : r.pass ? 'PASS' : 'FAIL';
    console.log(`  [${tag}] ${r.item}\n         measured ${r.measured}; limit ${r.limit}`);
  }
}

async function main(): Promise<void> {
  console.log('Geometry: building the app...');
  buildApp();
  const rows: Row[] = [];
  rows.push(...(await runLab()));
  rows.push(...(await runPageSize()));
  rows.push(...(await runReal()));
  print(rows);
  const asserted = rows.filter((r) => r.pass !== null);
  const failed = asserted.filter((r) => !r.pass);
  console.log(`\nGeometry: ${asserted.length - failed.length}/${asserted.length} checks passed${failed.length ? `, ${failed.length} FAILED` : ''}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
