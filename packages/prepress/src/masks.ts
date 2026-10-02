// Soft-mask (ExtGState /SMask /G) content carries alpha/luminosity, not ink. Everything reachable from a mask group
// (the group form, nested forms, tiling patterns, images) is "mask data": its RGB values must not be recoloured,
// and its RGB colour space is not a prepress problem.
import { PDFContext, PDFDict, PDFRawStream, PDFRef } from '@cantoo/pdf-lib';
import { N, dictGet } from './pdfio.ts';

export function maskReachable(ctx: PDFContext): Set<PDFRef> {
  const roots: PDFRef[] = [];
  for (const [, obj] of ctx.enumerateIndirectObjects()) {
    const d = obj instanceof PDFRawStream ? obj.dict : obj instanceof PDFDict ? obj : undefined;
    const sm = d && dictGet(ctx, d, 'SMask', PDFDict);
    const g = sm?.get(N('G'));
    if (g instanceof PDFRef) roots.push(g);
  }
  const seen = new Set<PDFRef>();
  const visit = (r: PDFRef) => {
    if (seen.has(r)) return;
    seen.add(r);
    const o = ctx.lookup(r);
    const d = o instanceof PDFRawStream ? o.dict : o instanceof PDFDict ? o : undefined;
    if (!d) return;
    const res = dictGet(ctx, d, 'Resources', PDFDict);
    for (const cat of ['XObject', 'Pattern']) {
      const sub = dictGet(ctx, res, cat, PDFDict);
      if (sub) for (const [, v] of sub.entries()) if (v instanceof PDFRef) visit(v);
    }
    const eg = dictGet(ctx, res, 'ExtGState', PDFDict);
    if (eg) for (const [, v] of eg.entries()) {
      const gd = ctx.lookup(v);
      const sm = gd instanceof PDFDict ? dictGet(ctx, gd, 'SMask', PDFDict) : undefined;
      const g = sm?.get(N('G'));
      if (g instanceof PDFRef) visit(g);
    }
    const smask = d.get(N('SMask')); // images carry their alpha as a separate image
    if (smask instanceof PDFRef) visit(smask);
  };
  roots.forEach(visit);
  return seen;
}
