/**
 * Writes fixtures/poster-basic.galley/{document.json,links.json} from the builder in poster-basic.ts, reading the
 * committed photo for its hash and pixel size. Run with `npm run fixtures`. A unit test (packages/model/test/fixture.test.ts)
 * fails when the committed files drift from this builder's output.
 */
import { serializeDocument } from '@galley/model';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { buildPosterBasic, POSTER_ENGINE_VERSION, type PosterPhoto } from './poster-basic';

const dir = path.resolve(__dirname, '../../fixtures/poster-basic.galley');

export async function readPhoto(): Promise<PosterPhoto> {
  const file = path.join(dir, 'assets/photo.jpg');
  const bytes = fs.readFileSync(file);
  const meta = await sharp(bytes).metadata();
  return { path: 'assets/photo.jpg', hash: `sha256:${createHash('sha256').update(bytes).digest('hex')}`, width: meta.width!, height: meta.height! };
}

async function main() {
  const doc = buildPosterBasic(await readPhoto());
  const files = serializeDocument(doc, { engineVersion: POSTER_ENGINE_VERSION });
  fs.writeFileSync(path.join(dir, 'document.json'), files.document);
  fs.writeFileSync(path.join(dir, 'links.json'), files.links);
  console.log(`wrote ${path.relative(process.cwd(), dir)}/document.json and links.json`);
}

if (require.main === module) void main();
