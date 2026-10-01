// Image handling. Skia embeds JPEGs as DCT streams (ICCBased if the file carried a profile, else DeviceRGB)
// and everything else as Flate RGB with a separate DeviceGray /SMask. Two modes:
//   cmyk    : convert to CMYK with sharp (lcms) through the output-intent profile, full resolution, Flate raw CMYK
//   rgb-icc : keep pixels, make sure they are ICC-tagged (allowed by PDF/X-4)
import { PDFArray, PDFContext, PDFDict, PDFName, PDFNumber, PDFRawStream, PDFRef } from '@cantoo/pdf-lib';
import sharp from 'sharp';
import * as pako from 'pako';
import fs from 'node:fs';
import { N, nameOf, streamBytes, streamOf } from './pdfio.ts';
import { effectiveCmyk, type SentinelTable } from './paint.ts';

export interface ImageReport { object: number; width: number; height: number; before: string; after: string; bytesBefore: number; bytesAfter: number; hasSMask: boolean; note?: string }


/**
 * Chromium/Skia rasterises things it cannot express natively (alpha gradients, blur) as RGB image + /SMask.
 * When the source colour was a single sentinel, every opaque-ish pixel is that sentinel +/- 1-2 levels (8-bit
 * un-premultiply noise). Detect that and return the paint so the image can be re-emitted as flat exact CMYK.
 */
function flatSentinel(ctx: PDFContext, d: PDFDict, raw: Uint8Array, w: number, h: number, table: SentinelTable) {
  const sm = streamOf(ctx, d.get(N('SMask')));
  if (!sm || raw.length !== w * h * 3) return null;
  let alpha: Uint8Array;
  try { alpha = streamBytes(sm); } catch { return null; }
  if (alpha.length !== w * h) return null;
  let hit: ReturnType<typeof table.nearest> = null;
  let counted = 0;
  for (let i = 0; i < w * h; i++) {
    if (alpha[i] < 40) continue; // low alpha => colour is quantisation noise
    const p = table.nearest(raw[3 * i], raw[3 * i + 1], raw[3 * i + 2], 6);
    if (!p) return null;
    if (hit && p !== hit) return null;
    hit = p; counted++;
  }
  return hit && counted ? hit : null;
}

export async function processImages(
  ctx: PDFContext,
  opts: { mode: 'cmyk' | 'rgb-icc'; cmykProfilePath: string; srgbProfilePath: string; table: SentinelTable; fallbackRasters: Set<PDFRef>; maskData: Set<PDFRef> },
): Promise<{ images: ImageReport[]; skipped: string[] }> {
  const images: ImageReport[] = [];
  const skipped: string[] = [];
  let srgbIccRef: PDFRef | undefined;
  const getSrgbIcc = () => (srgbIccRef ??= ctx.register(ctx.flateStream(fs.readFileSync(opts.srgbProfilePath), { N: 3, Alternate: N('DeviceRGB') })));

  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const d = obj.dict;
    if (nameOf(d.get(N('Subtype'))) !== 'Image') continue;
    if (d.get(N('ImageMask'))?.toString() === 'true') continue;
    const w = (ctx.lookup(d.get(N('Width')), PDFNumber) as PDFNumber).asNumber();
    const h = (ctx.lookup(d.get(N('Height')), PDFNumber) as PDFNumber).asNumber();
    const csObj = ctx.lookup(d.get(N('ColorSpace')));
    let csDesc = '?';
    let isRgb = false;
    if (csObj instanceof PDFName) { csDesc = csObj.decodeText(); isRgb = csDesc === 'DeviceRGB'; }
    else if (csObj instanceof PDFArray && nameOf(ctx.lookup(csObj.get(0))) === 'ICCBased') {
      const prof = ctx.lookup(csObj.get(1)) as PDFRawStream;
      const n = (ctx.lookup(prof.dict.get(N('N')), PDFNumber) as PDFNumber).asNumber();
      csDesc = `ICCBased(N=${n})`; isRgb = n === 3;
    }
    if (opts.maskData.has(ref)) { skipped.push(`obj ${ref.objectNumber}: ${w}x${h} ${csDesc} is soft-mask data (alpha/luminosity), left untouched`); continue; }
    const hasSMask = !!d.get(N('SMask'));
    if (!isRgb) { if (csDesc !== 'DeviceGray' && csDesc !== 'DeviceCMYK') skipped.push(`obj ${ref.objectNumber}: ${csDesc}`); continue; }

    const filter = d.get(N('Filter'));
    const filterName = filter instanceof PDFName ? filter.decodeText() : filter instanceof PDFArray ? nameOf(ctx.lookup(filter.get(0))) : undefined;
    const bytesBefore = obj.contents.length;

    // Alpha-gradient rasters (single sentinel colour + /SMask) become flat exact CMYK in BOTH modes
    if (filterName === 'FlateDecode' && !d.get(N('DecodeParms')) && hasSMask) {
      const raw = streamBytes(obj);
      const flat = flatSentinel(ctx, d, raw, w, h, opts.table);
      if (flat && flat.type === 'cmyk') {
        const cmyk = effectiveCmyk(flat).map((v) => Math.round(v * 255));
        const buf = Buffer.alloc(w * h * 4);
        for (let i = 0; i < w * h; i++) { buf[4 * i] = cmyk[0]; buf[4 * i + 1] = cmyk[1]; buf[4 * i + 2] = cmyk[2]; buf[4 * i + 3] = cmyk[3]; }
        const z = pako.deflate(buf);
        d.set(N('ColorSpace'), N('DeviceCMYK')); d.set(N('Filter'), N('FlateDecode')); d.set(N('BitsPerComponent'), PDFNumber.of(8));
        ctx.assign(ref, PDFRawStream.of(d, z));
        images.push({ object: ref.objectNumber, width: w, height: h, before: `${csDesc} FlateDecode + SMask`, after: `flat exact CMYK ${cmyk.map((v) => Math.round(v / 2.55)).join('/')} (sentinel "${flat.name}"), SMask kept`, bytesBefore, bytesAfter: z.length, hasSMask, note: `Skia rasterised an alpha gradient into a ${w}x${h}px tiling-pattern image covering the whole page (72 ppi); its colour was a single sentinel` });
        continue;
      }
    }
    // A raster that Skia synthesised from sentinel-coloured vector content (tiling-pattern fallback) holds interpolated
    // sentinel values, not real sRGB. Converting it through an ICC profile would silently produce wrong ink, so refuse.
    if (opts.fallbackRasters.has(ref)) {
      skipped.push(`obj ${ref.objectNumber}: ${w}x${h} ${csDesc} Skia fallback raster (tiling pattern) with mixed sentinel colours: NOT converted, left as RGB (needs export-mode redesign, see FINDINGS)`);
      continue;
    }
    if (opts.mode === 'rgb-icc') {
      if (csDesc === 'DeviceRGB') { d.set(N('ColorSpace'), ctx.obj([N('ICCBased'), getSrgbIcc()])); images.push({ object: ref.objectNumber, width: w, height: h, before: csDesc, after: 'ICCBased sRGB (tagged)', bytesBefore, bytesAfter: bytesBefore, hasSMask, note: 'DeviceRGB re-tagged as sRGB; assumes untagged source was sRGB' }); }
      else images.push({ object: ref.objectNumber, width: w, height: h, before: csDesc, after: csDesc + ' (unchanged)', bytesBefore, bytesAfter: bytesBefore, hasSMask });
      continue;
    }

    // cmyk mode
    let pipeline: ReturnType<typeof sharp>;
    if (filterName === 'DCTDecode') {
      pipeline = sharp(Buffer.from(obj.contents)); // sharp reads the embedded ICC if the JPEG carries one, else assumes sRGB
    } else if (filterName === 'FlateDecode' && !d.get(N('DecodeParms'))) {
      const raw = streamBytes(obj);
      // Flate sources lost their profile in Skia only when DeviceRGB; for ICCBased Flate images the profile stream is
      // available but not honoured here (TODO). sharp assumes sRGB for raw RGB input.
      pipeline = sharp(Buffer.from(raw), { raw: { width: w, height: h, channels: 3 } });
    } else { skipped.push(`obj ${ref.objectNumber}: filter ${filterName} not handled`); continue; }

    const { data, info } = await pipeline
      .withIccProfile(opts.cmykProfilePath, { attach: false })
      .toColourspace('cmyk')
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (info.channels !== 4 || info.width !== w || info.height !== h) { skipped.push(`obj ${ref.objectNumber}: sharp returned ${info.channels}ch ${info.width}x${info.height}`); continue; }

    const z = pako.deflate(data);
    d.set(N('ColorSpace'), N('DeviceCMYK'));
    d.set(N('Filter'), N('FlateDecode'));
    d.set(N('BitsPerComponent'), PDFNumber.of(8));
    d.delete(N('DecodeParms')); d.delete(N('ColorTransform'));
    ctx.assign(ref, PDFRawStream.of(d, z));
    images.push({ object: ref.objectNumber, width: w, height: h, before: `${csDesc} ${filterName}`, after: 'DeviceCMYK Flate (converted via output-intent profile)', bytesBefore, bytesAfter: z.length, hasSMask });
  }
  return { images, skipped };
}
