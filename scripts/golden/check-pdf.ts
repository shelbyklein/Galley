// Run the golden checks on one exported PDF. Used by the export e2e (apps/desktop/e2e/export), which cannot import the
// ESM workspace packages itself:
//   tsx scripts/golden/check-pdf.ts <pdf> <package dir> <bleed:on|off> <marks:on|off> <work dir>
// Prints one JSON line `{"checks":[...]}` and exits 0 when every check passed, 1 otherwise, 2 on an error.
import { parseDocument } from '@galley/model';
import { runGoldenChecks } from '@galley/prepress/verify';
import { readPackage } from './lib/app';

async function main(): Promise<void> {
  const [pdfPath, pkgDir, bleed, marks, workDir] = process.argv.slice(2);
  if (!pdfPath || !pkgDir || !workDir) throw new Error('usage: check-pdf <pdf> <package dir> <bleed:on|off> <marks:on|off> <work dir>');
  const doc = parseDocument(readPackage(pkgDir));
  const checks = await runGoldenChecks({ pdfPath, doc, options: { bleed: bleed === 'on', marks: marks === 'on' }, workDir });
  console.log(JSON.stringify({ checks }));
  process.exit(checks.every((c) => c.pass) ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
