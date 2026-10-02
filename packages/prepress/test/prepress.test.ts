// The whole post-processor on a hand-made PDF that looks like Chromium's output (sentinel RGB, a taller page), without
// Electron. The Electron + Ghostscript version of these checks is `npm run test:golden`.
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream } from '@cantoo/pdf-lib';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildSentinelTable } from '@galley/model';
import { describe, expect, it } from 'vitest';
import { exportPage, pageBoxes, prepress, selectProfiles } from '../src';
import { bytesToLatin1, streamBytes } from '../src/pdfio';
import { chromiumLikePdf, entryByKey, inkDoc, sentinelOperands } from './helpers';

const profiles = selectProfiles();
const haveProfile = profiles.output !== null && profiles.srgbPath !== null;
if (!haveProfile) console.warn('prepress.test: no CMYK output profile or sRGB profile on this machine; the end-to-end prepress tests are skipped');

const num = (o: unknown) => (o as PDFNumber).asNumber();
/** The decoded text of the n-th content stream of page 0. */
const contentStream = (doc: PDFDocument, n: number): string => {
  const contents = doc.getPage(0).node.lookup(PDFName.of('Contents'), PDFArray);
  return bytesToLatin1(streamBytes(doc.context.lookup(contents.get(n)) as PDFRawStream));
};
const box = (doc: PDFDocument, name: string): number[] => {
  const arr = doc.getPage(0).node.lookup(PDFName.of(name), PDFArray);
  return arr.asArray().map(num);
};

describe.skipIf(!haveProfile)('prepress on a Chromium-like PDF', () => {
  const doc = inkDoc({ width: 200, height: 100, bleed: 9, slug: 36 });
  const page = exportPage(doc.pages['page_1']!, { bleed: true, marks: true });
  const exportDoc = { ...doc, pages: { page_1: page } };
  const table = buildSentinelTable(exportDoc);
  const boxes = pageBoxes(page); // sheet 272 x 172, trim at (36, 36)
  const content = [
    '.24 0 0 -.24 0 173 cm', // like Skia: units are 1/300 in, y flipped (this page is 173 pt tall: one point taller than the sheet)
    'q 4.1666 0 0 4.1666 0 0 cm',
    `${sentinelOperands(entryByKey(table, 'orange|100|ko'))} rg 36 36 200 100 re f`,
    `${sentinelOperands(entryByKey(table, 'black|100|ko'))} rg 40 40 10 10 re f`,
    `${sentinelOperands(entryByKey(table, 'pms|40|ko'))} rg 60 40 10 10 re f`,
    `${sentinelOperands(entryByKey(table, 'black|100|op'))} rg 80 40 10 10 re f`,
    'Q',
  ].join('\n');

  async function run(options: { marks: boolean }) {
    const input = await chromiumLikePdf(content, boxes.sheet.width + 0.5, boxes.sheet.height + 1);
    return prepress(input, {
      sentinels: table,
      boxes,
      outputIntent: { profilePath: profiles.output!.path, ...profiles.output!.intent },
      photoMode: 'cmyk',
      srgbProfilePath: profiles.srgbPath!,
      title: 'Prepress test',
      marks: options.marks,
    });
  }

  it('writes exact boxes from the model: MediaBox is the sheet, TrimBox is the page, BleedBox is trim + bleed', async () => {
    const { bytes, report } = await run({ marks: true });
    const out = await PDFDocument.load(bytes);
    expect(box(out, 'MediaBox')).toEqual([0, 0, 272, 172]);
    expect(box(out, 'CropBox')).toEqual([0, 0, 272, 172]);
    expect(box(out, 'TrimBox')).toEqual([36, 36, 236, 136]); // 200 x 100: exactly the page size
    expect(box(out, 'BleedBox')).toEqual([27, 27, 245, 145]);
    expect(report.boxes['TrimBox']).toEqual([36, 36, 236, 136]);
    expect(report.pageSizeDeltaPt.h).toBe(1);
  });

  it('moves Chromium’s taller page so its top-left edge stays on the sheet', async () => {
    const { bytes } = await run({ marks: true });
    const out = await PDFDocument.load(bytes);
    expect(contentStream(out, 0).startsWith('q\n1 0 0 1 0 -1 cm\n')).toBe(true);
  });

  it('turns every sentinel into exact CMYK or a Separation and leaves no RGB operator', async () => {
    const { bytes, report } = await run({ marks: false });
    const out = await PDFDocument.load(bytes);
    const stream = contentStream(out, 0);
    expect(stream).toContain('0 0.6 1 0 k');
    expect(stream).toContain('0 0 0 1 k');
    expect(stream).toContain('/GalleySep0 cs 0.4 scn');
    expect(stream).toContain('/GalleyOP01 gs');
    expect(stream).not.toMatch(/\brg\b|\bRG\b/);
    expect(report.totals.rgbOps).toBe(4);
    expect(report.unmatched).toEqual([]);
    expect(report.spots).toEqual(['PANTONE 185 C']);
    expect(report.totals.maxRoundingError).toBeLessThan(0.1);
  });

  it('marks on adds a second content stream in /Separation /All; marks off does not', async () => {
    for (const marks of [true, false]) {
      const { bytes } = await run({ marks });
      const out = await PDFDocument.load(bytes);
      const contents = out.getPage(0).node.lookup(PDFName.of('Contents'), PDFArray);
      expect(contents.size()).toBe(marks ? 2 : 1);
      const res = out.getPage(0).node.Resources() as PDFDict;
      const cs = res.lookup(PDFName.of('ColorSpace'), PDFDict);
      const hasAll = [...cs.entries()].some(([name]) => name.decodeText() === 'GalleyRegistration');
      expect(hasAll).toBe(marks);
      // and the registration color is not in the file at all when there are no marks (the golden check "no /All marks")
      const separationAll = [...out.context.enumerateIndirectObjects()].filter(([, o]) => o instanceof PDFArray && o.size() >= 2 && o.get(0)?.toString() === '/Separation' && o.get(1)?.toString() === '/All');
      expect(separationAll.length).toBe(marks ? 1 : 0);
    }
  });

  it('makes a PDF/X-4 file: version, Info, XMP, output intent with the profile, and passes qpdf --check', async () => {
    const { bytes } = await run({ marks: true });
    expect(Buffer.from(bytes.subarray(0, 8)).toString('latin1')).toBe('%PDF-1.6');
    const out = await PDFDocument.load(bytes);
    const catalog = out.catalog;
    const intents = catalog.lookup(PDFName.of('OutputIntents'), PDFArray);
    const intent = intents.lookup(0, PDFDict);
    expect(intent.get(PDFName.of('S'))?.toString()).toBe('/GTS_PDFX');
    const profile = out.context.lookup(intent.get(PDFName.of('DestOutputProfile'))) as PDFRawStream;
    expect(num(profile.dict.get(PDFName.of('N')))).toBe(4);
    const xmp = Buffer.from((out.context.lookup(catalog.get(PDFName.of('Metadata'))) as PDFRawStream).contents).toString('utf8');
    expect(xmp).toContain('<pdfxid:GTS_PDFXVersion>PDF/X-4<');

    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'galley-prepress-')), 'out.pdf');
    fs.writeFileSync(file, bytes);
    const q = spawnSync('qpdf', ['--check', file], { encoding: 'utf8' });
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
    expect(q.stdout + q.stderr).toMatch(/No syntax or stream encoding errors/);
    expect(q.status).toBe(0);
  });

  it('refuses a Chromium page smaller than the sheet rather than cutting art', async () => {
    const small = await chromiumLikePdf(content, boxes.sheet.width - 1, boxes.sheet.height);
    await expect(
      prepress(small, { sentinels: table, boxes, outputIntent: { profilePath: profiles.output!.path, ...profiles.output!.intent }, photoMode: 'cmyk', srgbProfilePath: profiles.srgbPath!, title: 't', marks: false }),
    ).rejects.toThrow(/smaller than the 272 x 172 pt sheet/);
  });
});
