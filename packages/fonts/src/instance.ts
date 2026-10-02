import fs from 'node:fs';
import { createRequire } from 'node:module';
import * as fontkit from 'fontkit';
import type { FontFaceInfo, FontRequest } from './types';
const require = createRequire(`${process.cwd()}/package.json`);
const wawoff2 = require('wawoff2') as { decompress(bytes: Uint8Array): Promise<Uint8Array> };

/** A single font from a TTC. Preserve every table and its checksums; Chromium needs a separate face, not a collection. */
export function extractCollectionFace(input: Buffer, index: number): Buffer {
  if (input.toString('ascii', 0, 4) !== 'ttcf') return input;
  const start = input.readUInt32BE(12 + index * 4);
  const count = input.readUInt16BE(start + 4);
  const records = Array.from({ length: count }, (_, i) => {
    const at = start + 12 + i * 16;
    return { tag: input.toString('ascii', at, at + 4), checksum: input.readUInt32BE(at + 4), offset: input.readUInt32BE(at + 8), length: input.readUInt32BE(at + 12) };
  }).filter((r) => r.tag !== 'DSIG');
  const header = 12 + records.length * 16;
  const size = header + records.reduce((n, r) => n + Math.ceil(r.length / 4) * 4, 0);
  const output = Buffer.alloc(size);
  input.copy(output, 0, start, start + 4);
  output.writeUInt16BE(records.length, 4);
  const power = 2 ** Math.floor(Math.log2(records.length));
  output.writeUInt16BE(power * 16, 6); output.writeUInt16BE(Math.log2(power), 8); output.writeUInt16BE(records.length * 16 - power * 16, 10);
  let offset = header, head = 0;
  records.forEach((r, i) => {
    const at = 12 + i * 16;
    output.write(r.tag, at, 4, 'ascii'); output.writeUInt32BE(r.checksum, at + 4); output.writeUInt32BE(offset, at + 8); output.writeUInt32BE(r.length, at + 12);
    input.copy(output, offset, r.offset, r.offset + r.length);
    if (r.tag === 'head') { head = offset; output.writeUInt32BE(0, head + 8); }
    offset += Math.ceil(r.length / 4) * 4;
  });
  let sum = 0;
  for (let at = 0; at < output.length; at += 4) sum = (sum + output.readUInt32BE(at)) >>> 0;
  if (head) output.writeUInt32BE((0xB1B0AFBA - sum) >>> 0, head + 8);
  return output;
}

export async function sfntBytes(face: FontFaceInfo): Promise<Buffer> {
  const bytes = fs.readFileSync(face.path);
  return bytes.toString('ascii', 0, 4) === 'wOF2' ? Buffer.from(await wawoff2.decompress(bytes)) : extractCollectionFace(bytes, face.faceIndex);
}

type Hb = Record<string, (...args: number[]) => number> & { memory: { buffer: ArrayBuffer } };
const wasm = (globalThis as unknown as { WebAssembly: { instantiate(bytes: Uint8Array, imports: object): Promise<{ instance: { exports: unknown } }> } }).WebAssembly;
let harfbuzz: Promise<Hb> | undefined;
async function hb(): Promise<Hb> {
  harfbuzz ??= wasm.instantiate(fs.readFileSync(require.resolve('harfbuzzjs/dist/harfbuzz-subset.wasm')), {}).then(({ instance }) => {
    const exports = instance.exports as unknown as Hb;
    exports._initialize();
    return exports;
  });
  return harfbuzz;
}
const tag = (s: string) => [...s].reduce((n, c) => (n << 8) | c.charCodeAt(0), 0) >>> 0;
export function instanceAxes(face: FontFaceInfo, request: FontRequest): Record<string, number> {
  return Object.fromEntries(Object.entries(face.axes).map(([axis, limits]) => [axis, axis === 'wght' ? Math.max(limits.min, Math.min(limits.max, request.weight)) : limits.default]));
}
/** Full static instance in HarfBuzz WASM. Keep all glyphs/features: shaping must remain identical to the screen. */
export async function instanceFont(face: FontFaceInfo, request: FontRequest): Promise<Buffer> {
  if (!face.embeddable) throw new Error(`${face.family}: ${face.embeddingReason}`);
  const input = await sfntBytes(face);
  const h = await hb();
  const ptr = h.malloc(input.length);
  new Uint8Array(h.memory.buffer).set(input, ptr);
  const blob = h.hb_blob_create(ptr, input.length, 2, 0, 0);
  const original = h.hb_face_create(blob, 0);
  const subset = h.hb_subset_input_create_or_fail();
  let result = 0, resultBlob = 0;
  try {
    h.hb_subset_input_keep_everything(subset);
    for (const [axis, value] of Object.entries(instanceAxes(face, request))) {
      if (!h.hb_subset_input_pin_axis_location(subset, original, tag(axis), value)) throw new Error(`Could not pin ${face.family} ${axis}=${value}`);
    }
    result = h.hb_subset_or_fail(original, subset);
    if (!result) throw new Error(`HarfBuzz could not instance ${face.family}`);
    resultBlob = h.hb_face_reference_blob(result);
    const bytes = Buffer.from(new Uint8Array(h.memory.buffer, h.hb_blob_get_data(resultBlob, 0), h.hb_blob_get_length(resultBlob)));
    const inspected = fontkit.create(bytes);
    if ('variationAxes' in inspected && Object.keys(inspected.variationAxes).length) throw new Error(`HarfBuzz left unpinned axes in ${face.family}`);
    return bytes;
  } finally {
    if (resultBlob) h.hb_blob_destroy(resultBlob);
    if (result) h.hb_face_destroy(result);
    h.hb_subset_input_destroy(subset); h.hb_face_destroy(original); h.hb_blob_destroy(blob); h.free(ptr);
  }
}
