import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { assetSchema, type Asset } from '@galley/model';
import { z } from 'zod';
import { readImageInfo } from './image-info';
import type { LinkStatus } from '../../shared/ipc';

export const checkedAssetsSchema = z.array(assetSchema).max(10000);

/** Check only package-contained bytes on request. No external originals and no watcher. */
export function inspectLinks(root: string | null, input: unknown, decodes?: (bytes: Buffer) => boolean): LinkStatus[] {
  const assets: Asset[] = checkedAssetsSchema.parse(input);
  return assets.map((asset) => {
    const result = (status: LinkStatus['status'], detail?: string): LinkStatus => ({ assetId: asset.id, path: asset.path, status, ...(detail ? { detail } : {}) });
    if (!root) return result('missing');
    const file = path.resolve(root, asset.path);
    try {
      const realRoot = fs.realpathSync(root);
      const realFile = fs.realpathSync(file);
      if (!realFile.startsWith(realRoot + path.sep)) return result('unreadable', 'Link escapes its package');
      if (!fs.statSync(realFile).isFile()) return result('missing');
      const bytes = fs.readFileSync(realFile);
      if (!readImageInfo(bytes) || (decodes && !decodes(bytes))) return result('unreadable', 'Not a decodable PNG or JPEG image');
      const hash = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
      return result(hash === asset.hash ? 'ok' : 'changed');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      return code === 'ENOENT' ? result('missing') : result('unreadable', error instanceof Error ? error.message : String(error));
    }
  });
}
