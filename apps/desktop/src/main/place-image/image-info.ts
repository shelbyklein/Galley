/**
 * Reading what Galley needs to know about an image file without decoding it: pixel size, native resolution and color
 * space. PNG and JPEG only (what print layouts use; the editor shows them as they are). Pure and dependency-free so it
 * runs in the main process with no native module (unit-tested in image-info.test.ts).
 */

export interface ImageInfo {
  width: number;
  height: number;
  /** Pixels per inch recorded in the file; 72 when the file records none. */
  ppi: number;
  colorSpace: 'rgb' | 'cmyk' | 'gray';
  format: 'png' | 'jpeg';
}

const DEFAULT_PPI = 72;

/** Round a resolution computed from metric units to 2 decimals, so 11811 pixels per metre reads as 300, not 299.9994. */
const ppiOf = (value: number): number => {
  const r = Math.round(value * 100) / 100;
  return r > 0 && Number.isFinite(r) ? r : DEFAULT_PPI;
};

function readPng(b: Buffer): ImageInfo | null {
  if (b.length < 33 || b.readUInt32BE(0) !== 0x89504e47 || b.readUInt32BE(4) !== 0x0d0a1a0a) return null;
  let width = 0;
  let height = 0;
  let colorType = -1;
  let ppi = DEFAULT_PPI;
  let offset = 8;
  while (offset + 8 <= b.length) {
    const length = b.readUInt32BE(offset);
    const type = b.toString('latin1', offset + 4, offset + 8);
    const data = offset + 8;
    if (type === 'IHDR' && data + 13 <= b.length) {
      width = b.readUInt32BE(data);
      height = b.readUInt32BE(data + 4);
      colorType = b[data + 9]!;
    } else if (type === 'pHYs' && data + 9 <= b.length) {
      const perMetre = b.readUInt32BE(data);
      if (b[data + 8] === 1 && perMetre > 0) ppi = ppiOf(perMetre * 0.0254);
    } else if (type === 'IDAT' || type === 'IEND') {
      break;
    }
    offset = data + length + 4; // chunk data, then its CRC
  }
  if (width <= 0 || height <= 0) return null;
  return { width, height, ppi, colorSpace: colorType === 0 || colorType === 4 ? 'gray' : 'rgb', format: 'png' };
}

/** The resolution in an EXIF block (the APP1 payload after "Exif\0\0"), or null. */
function exifPpi(tiff: Buffer): number | null {
  if (tiff.length < 8) return null;
  const little = tiff.toString('latin1', 0, 2) === 'II';
  const u16 = (o: number) => (little ? tiff.readUInt16LE(o) : tiff.readUInt16BE(o));
  const u32 = (o: number) => (little ? tiff.readUInt32LE(o) : tiff.readUInt32BE(o));
  if (u16(2) !== 42) return null;
  const ifd = u32(4);
  if (ifd + 2 > tiff.length) return null;
  const count = u16(ifd);
  let xRes: number | null = null;
  let unit = 2;
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > tiff.length) break;
    const tag = u16(entry);
    if (tag === 0x011a) {
      const at = u32(entry + 8);
      if (at + 8 <= tiff.length) {
        const den = u32(at + 4);
        xRes = den > 0 ? u32(at) / den : null;
      }
    } else if (tag === 0x0128) {
      unit = u16(entry + 8);
    }
  }
  if (xRes === null || xRes <= 0) return null;
  return unit === 3 ? ppiOf(xRes * 2.54) : ppiOf(xRes);
}

function readJpeg(b: Buffer): ImageInfo | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let ppi: number | null = null;
  let offset = 2;
  while (offset + 4 <= b.length) {
    if (b[offset] !== 0xff) {
      offset++;
      continue;
    }
    const marker = b[offset + 1]!;
    if (marker === 0xff) {
      offset++;
      continue;
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      offset += 2;
      continue;
    }
    const length = b.readUInt16BE(offset + 2);
    const data = offset + 4;
    if (marker === 0xe0 && b.toString('latin1', data, data + 5) === 'JFIF\0') {
      const units = b[data + 7]!;
      const x = b.readUInt16BE(data + 8);
      if (units === 1 && x > 0) ppi ??= ppiOf(x);
      else if (units === 2 && x > 0) ppi ??= ppiOf(x * 2.54);
    } else if (marker === 0xe1 && b.toString('latin1', data, data + 6) === 'Exif\0\0') {
      ppi ??= exifPpi(b.subarray(data + 6, offset + 2 + length));
    } else if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = b.readUInt16BE(data + 1);
      const width = b.readUInt16BE(data + 3);
      const components = b[data + 5]!;
      if (width <= 0 || height <= 0) return null;
      return { width, height, ppi: ppi ?? DEFAULT_PPI, colorSpace: components === 1 ? 'gray' : components === 4 ? 'cmyk' : 'rgb', format: 'jpeg' };
    }
    offset += 2 + length;
  }
  return null;
}

/** Pixel size, resolution and color space of a PNG or JPEG file's bytes; null for anything else. */
export function readImageInfo(bytes: Buffer): ImageInfo | null {
  return readPng(bytes) ?? readJpeg(bytes);
}
