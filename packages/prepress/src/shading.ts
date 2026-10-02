// Gradient (shading) rewrite: DeviceRGB sentinel stops -> DeviceCMYK.
// Skia (Chromium 152) emits axial/radial shadings with Function type 2 (2 stops) or type 3 stitching of type 2.
import { PDFArray, PDFContext, PDFDict, PDFName, PDFNumber, PDFRawStream } from '@cantoo/pdf-lib';
import { N, dictGet, nameOf, numArray } from './pdfio.ts';
import { effectiveCmyk, type SentinelTable } from './paint.ts';

export interface ShadingReport { rewritten: number; functionTypes: Record<string, number>; shadingTypes: Record<string, number>; unsupported: string[]; stops: string[] }

export function rewriteShadings(ctx: PDFContext, table: SentinelTable): ShadingReport {
  const rep: ShadingReport = { rewritten: 0, functionTypes: {}, shadingTypes: {}, unsupported: [], stops: [] };
  const seen = new Set<PDFDict>();

  const mapColor = (rgb: number[], where: string): number[] | null => {
    const p = table.lookup(rgb[0], rgb[1], rgb[2]);
    if (!p) {
      if (rgb.every((v) => v < 0.002)) return [0, 0, 0, 1];
      rep.unsupported.push(`${where}: stop colour ${rgb.join(' ')} is not a sentinel`);
      return null;
    }
    if (p.model !== 'cmyk') { rep.unsupported.push(`${where}: spot colour "${p.name}" in a gradient needs a Separation-space shading (not implemented)`); return null; }
    rep.stops.push(`${p.name}@${p.tint}% -> ${effectiveCmyk(p).map((v) => Math.round(v * 100)).join('/')}`);
    return effectiveCmyk(p);
  };

  const rewriteFn = (fn: any, where: string): boolean => {
    const fo = ctx.lookup(fn);
    const d: PDFDict | undefined = fo instanceof PDFDict ? fo : fo instanceof PDFRawStream ? fo.dict : undefined; // type 0/4 functions are streams
    if (!d) { rep.unsupported.push(`${where}: function not a dict`); return false; }
    const type = (ctx.lookup(d.get(N('FunctionType')), PDFNumber) as PDFNumber).asNumber();
    rep.functionTypes[type] = (rep.functionTypes[type] ?? 0) + 1;
    if (type === 2) {
      const c0 = numArray(ctx, d.get(N('C0'))) ?? [0], c1 = numArray(ctx, d.get(N('C1'))) ?? [1];
      if (c0.length !== 3 || c1.length !== 3) { rep.unsupported.push(`${where}: type 2 function with ${c0.length} outputs`); return false; }
      const m0 = mapColor(c0, where), m1 = mapColor(c1, where);
      if (!m0 || !m1) return false;
      d.set(N('C0'), ctx.obj(m0)); d.set(N('C1'), ctx.obj(m1));
      return true;
    }
    if (type === 3) {
      const fns = ctx.lookup(d.get(N('Functions')), PDFArray) as PDFArray;
      let ok = true;
      for (let i = 0; i < fns.size(); i++) ok = rewriteFn(fns.get(i), `${where}/fn${i}`) && ok;
      return ok;
    }
    rep.unsupported.push(`${where}: FunctionType ${type} (PostScript/sampled) not handled; would need a stop-extraction or sampling pass`);
    return false;
  };

  const visit = (d: PDFDict, where: string) => {
    if (seen.has(d)) return;
    seen.add(d);
    const st = d.get(N('ShadingType'));
    if (st) {
      const t = (ctx.lookup(st, PDFNumber) as PDFNumber).asNumber();
      rep.shadingTypes[t] = (rep.shadingTypes[t] ?? 0) + 1;
      const cs = nameOf(ctx.lookup(d.get(N('ColorSpace'))));
      if (cs === 'DeviceRGB') {
        const fn = d.get(N('Function'));
        if (!fn) { rep.unsupported.push(`${where}: shading type ${t} without /Function (mesh shadings carry colour in the stream)`); return; }
        if (ctx.lookup(fn) instanceof PDFArray) { rep.unsupported.push(`${where}: /Function array`); return; }
        if (rewriteFn(fn, where)) { d.set(N('ColorSpace'), N('DeviceCMYK')); rep.rewritten++; }
      }
    }
  };

  // Walk every indirect object and all directly-nested dicts/arrays (resources are often direct dicts).
  const walk = (o: any, where: string) => {
    if (o instanceof PDFRawStream) o = o.dict;
    if (o instanceof PDFDict) {
      visit(o, where);
      for (const [k, v] of o.entries()) walk(v, `${where}/${k.decodeText()}`);
    } else if (o instanceof PDFArray) {
      for (let i = 0; i < o.size(); i++) walk(o.get(i), `${where}[${i}]`);
    }
  };
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) walk(obj, `obj ${ref.objectNumber}`);
  return rep;
}
