/** Linking a chosen image file into a package: copy it to `<package>/assets/` and describe it. No Electron imports, so it is unit-tested. */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { PlacedImage } from '../../shared/ipc';
import { readImageInfo } from './image-info';

const sha256 = (bytes: Buffer): string => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

/** A file name that is safe as a package path segment: letters, digits, space and `._-()`. */
export function safeAssetName(name: string): string {
  const cleaned = name.replace(/[^\w .()\-]/g, '_').replace(/^\.+/, '_').trim();
  return cleaned.length > 0 ? cleaned : 'image';
}

/** Copy `source` into `<pkg>/assets/` (reusing an identical file, renaming on a clash) and describe it. */
export function linkImage(pkg: string, source: string): PlacedImage {
  const bytes = fs.readFileSync(source);
  const info = readImageInfo(bytes);
  if (!info) throw new Error(`"${path.basename(source)}" is not a PNG or JPEG image, the formats Galley can place`);
  const hash = sha256(bytes);

  const dir = path.join(pkg, 'assets');
  fs.mkdirSync(dir, { recursive: true });
  const base = safeAssetName(path.basename(source));
  const ext = path.extname(base);
  const stem = base.slice(0, base.length - ext.length);
  let name = base;
  for (let n = 2; ; n++) {
    const target = path.join(dir, name);
    if (!fs.existsSync(target)) {
      fs.writeFileSync(target, bytes);
      break;
    }
    if (sha256(fs.readFileSync(target)) === hash) break; // the same file is already linked
    name = `${stem}-${n}${ext}`;
  }
  return { path: `assets/${name}`, hash, width: info.width, height: info.height, ppi: info.ppi, colorSpace: info.colorSpace };
}
