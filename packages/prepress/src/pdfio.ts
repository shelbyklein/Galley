// Small helpers over @cantoo/pdf-lib for reading/writing streams and navigating dicts.
import {
  PDFArray, PDFContext, PDFDict, PDFName, PDFNumber, PDFObject, PDFRawStream, PDFRef, PDFStream, decodePDFRawStream,
} from '@cantoo/pdf-lib';
import * as pako from 'pako';

export const N = (s: string) => PDFName.of(s);

export function streamBytes(s: PDFStream): Uint8Array {
  if (!(s instanceof PDFRawStream)) throw new Error('only raw (parsed) streams supported');
  return decodePDFRawStream(s).decode();
}
export const bytesToLatin1 = (u: Uint8Array) => Buffer.from(u).toString('latin1');
export const latin1ToBytes = (s: string) => Buffer.from(s, 'latin1');

/** Replace the object at ref with a Flate-compressed copy of `bytes`, preserving all other dict entries. */
export function replaceStreamData(ctx: PDFContext, ref: PDFRef, old: PDFRawStream, bytes: Uint8Array | Buffer) {
  const dict = old.dict;
  dict.set(N('Filter'), N('FlateDecode'));
  dict.delete(N('DecodeParms'));
  ctx.assign(ref, PDFRawStream.of(dict, pako.deflate(bytes)));
}

export function dictGet<T extends PDFObject>(ctx: PDFContext, d: PDFDict | undefined, key: string, type: { prototype: T }): T | undefined {
  if (!d) return undefined;
  const v = ctx.lookup(d.get(N(key))); // tolerant: wrong type (e.g. /SMask /None) -> undefined
  return v instanceof (type as any) ? (v as T) : undefined;
}

export function nameOf(o: PDFObject | undefined): string | undefined {
  return o instanceof PDFName ? o.decodeText() : undefined;
}

/** Get (creating if needed) a sub-dictionary of a Resources dict, e.g. /ColorSpace or /ExtGState. */
export function resSub(ctx: PDFContext, res: PDFDict, key: string): PDFDict {
  const existing = ctx.lookupMaybe(res.get(N(key)), PDFDict);
  if (existing) return existing;
  const d = ctx.obj({}) as PDFDict;
  res.set(N(key), d);
  return d;
}

export function numArray(ctx: PDFContext, a: PDFObject | undefined): number[] | undefined {
  const arr = ctx.lookupMaybe(a, PDFArray);
  if (!arr) return undefined;
  return arr.asArray().map((x) => (ctx.lookup(x, PDFNumber) as PDFNumber).asNumber());
}

export function streamOf(ctx: PDFContext, o: PDFObject | undefined): PDFRawStream | undefined {
  const v = ctx.lookup(o);
  return v instanceof PDFRawStream ? v : undefined;
}
