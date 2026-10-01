// Scan a PDF for anything still in an RGB colour space: vector colour ops, images, shadings, groups, resources.
import fs from 'node:fs';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef } from '@cantoo/pdf-lib';
import { parseContent } from './prepress/tokenizer.ts';
import { bytesToLatin1, streamBytes } from './prepress/pdfio.ts';
import { maskReachable } from './prepress/masks.ts';

export interface Leftover { where: string; what: string }
export async function scanRgb(pdfPath: string) {
  const doc = await PDFDocument.load(fs.readFileSync(pdfPath), { updateMetadata: false });
  const ctx = doc.context;
  const left: Leftover[] = [];
  const maskData = maskReachable(ctx); // soft-mask content is alpha/luminosity data: exempt
  const info: { streamsScanned: number; vectorRgbOps: number; grayOps: number; rgbSpaces: number; maskObjects?: number } = { streamsScanned: 0, vectorRgbOps: 0, grayOps: 0, rgbSpaces: 0 };
  const nm = (o: any) => (o instanceof PDFName ? o.decodeText() : undefined);
  const csIsRgb = (cs: any): string | null => {
    cs = ctx.lookup(cs);
    if (cs instanceof PDFName) return ['DeviceRGB', 'CalRGB'].includes(cs.decodeText()) ? cs.decodeText() : null;
    if (cs instanceof PDFArray) {
      const t = nm(ctx.lookup(cs.get(0)));
      if (t === 'CalRGB') return 'CalRGB';
      if (t === 'ICCBased') { const pr = ctx.lookup(cs.get(1)) as PDFRawStream; const n = (ctx.lookup(pr.dict.get(PDFName.of('N')), PDFNumber) as PDFNumber).asNumber(); return n === 3 ? 'ICCBased(N=3)' : null; }
      if (t === 'Separation' || t === 'DeviceN') return csIsRgb(cs.get(2));
      if (t === 'Indexed') return csIsRgb(cs.get(1));
    }
    return null;
  };
  const scanStream = (src: string, where: string) => {
    info.streamsScanned++;
    for (const op of parseContent(src)) {
      if (op.operator === 'rg' || op.operator === 'RG') { info.vectorRgbOps++; left.push({ where, what: `${op.operator} (DeviceRGB vector colour)` }); }
      if (op.operator === 'g' || op.operator === 'G') info.grayOps++;
      if ((op.operator === 'cs' || op.operator === 'CS') && op.operands[0]?.kind === 'name' && op.operands[0].value === 'DeviceRGB') left.push({ where, what: 'cs /DeviceRGB' });
    }
  };
  const pageContents = new Set<PDFRef>();
  for (const page of doc.getPages()) {
    const c = page.node.get(PDFName.of('Contents'));
    const r = ctx.lookup(c);
    const refs = r instanceof PDFArray ? r.asArray() : [c];
    refs.forEach((x: any) => pageContents.add(x));
  }
  let pi = 0;
  for (const ref of pageContents) { const s = ctx.lookup(ref) as PDFRawStream; scanStream(bytesToLatin1(streamBytes(s)), `page content ${++pi}`); }
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    const d = obj instanceof PDFRawStream ? obj.dict : obj instanceof PDFDict ? obj : undefined;
    if (!d) continue;
    const where = `obj ${ref.objectNumber}`;
    if (maskData.has(ref)) { info.maskObjects = (info.maskObjects ?? 0) + 1; continue; }
    const sub = nm(d.get(PDFName.of('Subtype')));
    if (obj instanceof PDFRawStream && (sub === 'Form' || ctx.lookup(d.get(PDFName.of('PatternType'))) instanceof PDFNumber && (ctx.lookup(d.get(PDFName.of('PatternType'))) as PDFNumber).asNumber() === 1))
      scanStream(bytesToLatin1(streamBytes(obj)), `${sub === 'Form' ? 'form' : 'tiling pattern'} ${where}`);
    if (sub === 'Type3') {
      const cp = ctx.lookup(d.get(PDFName.of('CharProcs'))) as PDFDict | undefined;
      if (cp) for (const [, v] of cp.entries()) { const s = ctx.lookup(v) as PDFRawStream; scanStream(bytesToLatin1(streamBytes(s)), `type3 glyph (${where})`); }
    }
    if (sub === 'Image' && ctx.lookup(d.get(PDFName.of('ImageMask')))?.toString() !== 'true') {
      const k = csIsRgb(d.get(PDFName.of('ColorSpace')));
      if (k) { info.rgbSpaces++; left.push({ where, what: `image ${ctx.lookup(d.get(PDFName.of('Width')))}x${ctx.lookup(d.get(PDFName.of('Height')))} in ${k}` }); }
    }
    if (d.get(PDFName.of('ShadingType'))) { const k = csIsRgb(d.get(PDFName.of('ColorSpace'))); if (k) { info.rgbSpaces++; left.push({ where, what: `shading in ${k}` }); } }
    const grp = ctx.lookup(d.get(PDFName.of('Group')));
    if (grp instanceof PDFDict && nm(grp.get(PDFName.of('S'))) === 'Transparency') { const k = csIsRgb(grp.get(PDFName.of('CS'))); if (k) { info.rgbSpaces++; left.push({ where, what: `transparency group CS ${k}` }); } }
    const csRes = ctx.lookup(d.get(PDFName.of('ColorSpace')));
    if (csRes instanceof PDFDict) for (const [k, v] of csRes.entries()) { const kk = csIsRgb(v); if (kk) { info.rgbSpaces++; left.push({ where, what: `ColorSpace resource /${k.decodeText()} = ${kk}` }); } }
  }
  // page-level group
  for (const page of doc.getPages()) {
    const g = ctx.lookup(page.node.get(PDFName.of('Group')));
    if (g instanceof PDFDict) { const k = csIsRgb(g.get(PDFName.of('CS'))); if (k) left.push({ where: 'page', what: `page group CS ${k}` }); }
  }
  return { left, info, doc };
}

