// Prepress post-processor: Chromium (Skia) RGB PDF -> press-ready PDF/X-4 with exact CMYK/spot.
import {
  PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFStream,
} from '@cantoo/pdf-lib';
import fs from 'node:fs';
import { N, bytesToLatin1, dictGet, latin1ToBytes, nameOf, replaceStreamData, resSub, streamBytes, streamOf } from './pdfio.ts';
import { SentinelTable, type Paint } from './paint.ts';
import { opGsName, rewriteContent, spotResName, type RewriteStats } from './rewrite.ts';
import { rewriteShadings, type ShadingReport } from './shading.ts';
import { processImages, type ImageReport } from './images.ts';
import { marksStream, type Geometry } from './marks.ts';
import { addMetadata, addOutputIntent, type OutputIntentSpec } from './pdfx.ts';
import { maskReachable } from './masks.ts';

export interface PrepressOptions {
  sentinels: Paint[];
  geometry: Geometry;
  outputIntent: OutputIntentSpec;
  photoMode: 'cmyk' | 'rgb-icc';
  srgbProfilePath: string;
  title: string;
  marks: boolean;
}

export interface PrepressReport {
  streams: { where: string; kind: string; bytesIn: number; bytesOut: number; rgbOps: number; cmykOut: number; spotOut: number; overprintToggles: number }[];
  totals: { rgbOps: number; sentinelHits: Record<string, number>; cmykOut: number; spotOut: number; overprintToggles: number; defaultBlack: number; defaultWhite: number; maxRoundingError: number };
  unmatched: string[];
  unhandled: string[];
  otherColorOps: Record<string, number>;
  shadings: ShadingReport;
  groups: { object: string; before: string; after: string }[];
  images: ImageReport[];
  skippedImages: string[];
  spots: string[];
  boxes: Record<string, number[]>;
  pdfx: { docId: string; id: string[] };
  pageSizeDeltaPt?: { w: number; h: number };
}

export async function prepress(input: Uint8Array, opts: PrepressOptions): Promise<{ bytes: Uint8Array; report: PrepressReport }> {
  const doc = await PDFDocument.load(input, { updateMetadata: false });
  const ctx = doc.context;
  const table = new SentinelTable(opts.sentinels);
  const spotOrder = [...new Set(opts.sentinels.filter((p) => p.type === 'spot').map((p) => p.spotName ?? p.name))];

  // ---- document-level resources: Separation colour spaces and overprint ExtGStates
  const sepRefs = new Map<string, PDFRef>();
  for (const spot of spotOrder) {
    const p = opts.sentinels.find((x) => x.type === 'spot' && (x.spotName ?? x.name) === spot)!;
    const alt = p.values.map((v) => v / 100); // full-strength CMYK alternate
    const fn = ctx.register(ctx.obj({ FunctionType: 2, Domain: [0, 1], C0: [0, 0, 0, 0], C1: alt, N: 1 }));
    sepRefs.set(spot, ctx.register(ctx.obj([N('Separation'), N(spot), N('DeviceCMYK'), fn])));
  }
  const regRef = ctx.register(ctx.obj([N('Separation'), N('All'), N('DeviceCMYK'), ctx.register(ctx.obj({ FunctionType: 2, Domain: [0, 1], C0: [0, 0, 0, 0], C1: [1, 1, 1, 1], N: 1 }))]));
  const gsRefs = new Map<string, PDFRef>();
  for (const stroke of [false, true]) for (const fill of [false, true]) {
    const d = ctx.obj({ Type: 'ExtGState', OP: stroke, op: fill, OPM: 1 });
    gsRefs.set(opGsName(stroke, fill), ctx.register(d));
  }

  const report: PrepressReport = {
    streams: [], totals: { rgbOps: 0, sentinelHits: {}, cmykOut: 0, spotOut: 0, overprintToggles: 0, defaultBlack: 0, defaultWhite: 0, maxRoundingError: 0 },
    unmatched: [], unhandled: [], otherColorOps: {}, shadings: { rewritten: 0, functionTypes: {}, shadingTypes: {}, unsupported: [], stops: [] },
    groups: [], images: [], skippedImages: [], spots: spotOrder, boxes: {}, pdfx: { docId: '', id: [] },
  };

  const addResources = (res: PDFDict, spots: Set<string>, gs: Set<string>) => {
    if (spots.size) { const cs = resSub(ctx, res, 'ColorSpace'); for (const s of spots) cs.set(N(spotResName(s, spotOrder)), sepRefs.get(s)!); }
    if (gs.size) { const eg = resSub(ctx, res, 'ExtGState'); for (const g of gs) eg.set(N(g), gsRefs.get(g)!); }
  };
  const accumulate = (where: string, kind: string, inLen: number, outLen: number, st: RewriteStats) => {
    const t = report.totals;
    t.rgbOps += st.rgbOps; t.cmykOut += st.cmykOut; t.spotOut += st.spotOut; t.overprintToggles += st.overprintToggles;
    t.defaultBlack += st.defaultBlack; t.defaultWhite += st.defaultWhite;
    for (const [k, v] of st.sentinelHits) t.sentinelHits[k] = (t.sentinelHits[k] ?? 0) + v;
    for (const [k, v] of st.otherColorOps) report.otherColorOps[k] = (report.otherColorOps[k] ?? 0) + v;
    report.unmatched.push(...st.unmatched); report.unhandled.push(...st.unhandled);
    report.streams.push({ where, kind, bytesIn: inLen, bytesOut: outLen, rgbOps: st.rgbOps, cmykOut: st.cmykOut, spotOut: st.spotOut, overprintToggles: st.overprintToggles });
  };

  // ---- geometry. Chromium quantises @page size to 1/300 in, so its MediaBox may differ slightly from the document
  // model. Boxes are set from the model, anchored to the top-left corner (CSS origin) of the page Chromium produced.
  const pages = doc.getPages();
  const g0 = opts.geometry;
  const chromiumMedia = pages[0].getMediaBox();
  const trimW = g0.trim[2] - g0.trim[0], trimH = g0.trim[3] - g0.trim[1];
  const topMargin = g0.pageH - g0.trim[3]; // page top -> trim top, model units
  const ty1 = chromiumMedia.height - topMargin, ty0 = ty1 - trimH;
  const g: Geometry = { pageW: g0.pageW, pageH: chromiumMedia.height, trim: [g0.trim[0], ty0, g0.trim[0] + trimW, ty1], bleed: g0.bleed };
  const [tx0, , tx1] = g.trim;
  const chromiumH = chromiumMedia.height;
  report.pageSizeDeltaPt = { w: chromiumMedia.width - g0.pageW, h: chromiumMedia.height - g0.pageH };

  // ---- page content streams (concatenate if the page has several; colour state spans them)
  for (const [pi, page] of pages.entries()) {
    const contentsObj = page.node.get(N('Contents'));
    const resolved = ctx.lookup(contentsObj);
    const streams: PDFRawStream[] = resolved instanceof PDFArray ? resolved.asArray().map((r) => ctx.lookup(r) as PDFRawStream) : [resolved as PDFRawStream];
    const src = streams.map((s) => bytesToLatin1(streamBytes(s))).join('\n');
    const res = page.node.Resources() as PDFDict;
    const r = rewriteContent(src, table, spotOrder, `page ${pi + 1}`);
    accumulate(`page ${pi + 1} /Contents`, 'page', src.length, r.out.length, r.stats);
    addResources(res, r.spotsUsed, r.gsUsed);
    // wrap original content in q ... Q so marks are drawn in default user space (Skia leaves a scaling cm active)
    const body = ctx.register(ctx.flateStream(latin1ToBytes('q\n' + r.out + '\nQ\n')));
    const newContents: PDFRef[] = [body];
    if (opts.marks) {
      resSub(ctx, res, 'ColorSpace').set(N('GalleyRegistration'), regRef);
      newContents.push(ctx.register(ctx.flateStream(latin1ToBytes(marksStream(g, 'GalleyRegistration')))));
    }
    page.node.set(N('Contents'), ctx.obj(newContents));
  }

  // ---- forms, tiling patterns, Type3 glyph procs
  const maskData = maskReachable(ctx); // soft-mask groups and everything inside them: alpha/luminosity data, never recoloured
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const d = obj.dict;
    const sub = nameOf(d.get(N('Subtype')));
    const isForm = sub === 'Form';
    const isTiling = (ctx.lookupMaybe(d.get(N('PatternType')), PDFNumber)?.asNumber() ?? 0) === 1;
    if (isForm || isTiling) {
      const where = `${isForm ? 'form' : 'tiling pattern'} obj ${ref.objectNumber}`;
      if (maskData.has(ref)) {
        // soft-mask groups carry luminosity/alpha data, not ink: never recolour them
        report.groups.push({ object: where + ' (inside soft mask)', before: nameOf(ctx.lookup((dictGet(ctx, d, 'Group', PDFDict) as PDFDict | undefined)?.get(N('CS')))) ?? '(none)', after: 'left untouched (mask data)' });
        continue;
      }
      const src = bytesToLatin1(streamBytes(obj));
      const r = rewriteContent(src, table, spotOrder, where);
      accumulate(where, isForm ? 'form' : 'tiling', src.length, r.out.length, r.stats);
      const needRes = r.spotsUsed.size || r.gsUsed.size;
      if (needRes) {
        let res = dictGet(ctx, d, 'Resources', PDFDict);
        if (!res) { res = ctx.obj({}) as PDFDict; d.set(N('Resources'), res); }
        addResources(res, r.spotsUsed, r.gsUsed);
      }
      if (r.out !== src) replaceStreamData(ctx, ref, obj, latin1ToBytes(r.out));
      // transparency group colour space
      const grp = dictGet(ctx, d, 'Group', PDFDict);
      if (grp && nameOf(grp.get(N('S'))) === 'Transparency') {
        const before = nameOf(ctx.lookup(grp.get(N('CS')))) ?? '(unset)';
        if (before === '(unset)' || before === 'DeviceRGB') { grp.set(N('CS'), N('DeviceCMYK')); report.groups.push({ object: where, before, after: 'DeviceCMYK' }); }
        else report.groups.push({ object: where, before, after: before + ' (left)' });
      }
    }
  }
  // Type3 glyph procs (variable-font text): report any colour operators; d1 glyphs inherit the text fill colour
  for (const [, obj] of ctx.enumerateIndirectObjects()) {
    const d = obj instanceof PDFDict ? obj : undefined;
    if (!d || nameOf(d.get(N('Subtype'))) !== 'Type3') continue;
    const cp = dictGet(ctx, d, 'CharProcs', PDFDict);
    if (!cp) continue;
    let colorOps = 0;
    for (const [, v] of cp.entries()) {
      const s = streamOf(ctx, v);
      if (!s) continue;
      const src = bytesToLatin1(streamBytes(s));
      const r = rewriteContent(src, table, spotOrder, 'type3 glyph');
      colorOps += r.stats.rgbOps + [...r.stats.otherColorOps.values()].reduce((a, b) => a + b, 0);
      if (r.stats.rgbOps) report.unhandled.push(`type3 glyph proc contains ${r.stats.rgbOps} RGB colour ops (d0 glyph)`);
    }
    report.streams.push({ where: 'type3 font glyph procs', kind: 'type3', bytesIn: 0, bytesOut: 0, rgbOps: colorOps, cmykOut: 0, spotOut: 0, overprintToggles: 0 });
  }

  // ---- gradients
  report.shadings = rewriteShadings(ctx, table);

  // ---- images
  // images that live inside tiling patterns are Skia's raster fallback (alpha gradients, tiled gradients, ...)
  const fallbackRasters = new Set<PDFRef>();
  for (const [, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream) || (ctx.lookupMaybe(obj.dict.get(N('PatternType')), PDFNumber)?.asNumber() ?? 0) !== 1) continue;
    const xo = dictGet(ctx, dictGet(ctx, obj.dict, 'Resources', PDFDict), 'XObject', PDFDict);
    if (xo) for (const [, v] of xo.entries()) if (v instanceof PDFRef) fallbackRasters.add(v);
  }
  const img = await processImages(ctx, { mode: opts.photoMode, cmykProfilePath: opts.outputIntent.profilePath, srgbProfilePath: opts.srgbProfilePath, table, fallbackRasters, maskData });
  report.images = img.images; report.skippedImages = img.skipped;

  // ---- page boxes, page-level transparency group
  for (const page of pages) {
    page.setMediaBox(0, 0, g.pageW, chromiumH);
    page.setCropBox(0, 0, g.pageW, chromiumH);
    page.setBleedBox(tx0 - g.bleed, ty0 - g.bleed, tx1 - tx0 + 2 * g.bleed, ty1 - ty0 + 2 * g.bleed);
    page.setTrimBox(tx0, ty0, tx1 - tx0, ty1 - ty0);
    page.node.set(N('Group'), ctx.obj({ Type: 'Group', S: 'Transparency', CS: 'DeviceCMYK' }));
  }
  report.boxes = { MediaBox: [0, 0, g.pageW, chromiumH], BleedBox: [tx0 - g.bleed, ty0 - g.bleed, tx1 + g.bleed, ty1 + g.bleed], TrimBox: [tx0, ty0, tx1, ty1] };

  // ---- output intent + PDF/X-4 metadata
  const catalog = doc.catalog;
  addOutputIntent(ctx, catalog, opts.outputIntent);
  const info = ctx.lookup(ctx.trailerInfo.Info, PDFDict) as PDFDict;
  const now = new Date();
  const meta = addMetadata(ctx, catalog, info, { title: opts.title, creator: 'Galley press spike (Chromium/Skia + prepress)', producer: 'Galley prepress spike (@cantoo/pdf-lib)', created: now, modified: now });
  report.pdfx = { docId: meta.docId, id: meta.id };

  report.totals.maxRoundingError = table.maxRoundingError;
  const saved = await doc.save({ useObjectStreams: false, updateFieldAppearances: false });
  // PDF/X-4 (ISO 15930-7) is based on PDF 1.6; pdf-lib keeps Chromium's 1.4 header, so force 1.6
  const head = Buffer.from(saved.subarray(0, 8)).toString('latin1');
  if (/^%PDF-1\.\d$/.test(head)) saved.set(Buffer.from('%PDF-1.6'), 0);
  return { bytes: saved, report };
}
