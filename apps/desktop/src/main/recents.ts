// The recent-files list: a small JSON file in the app's user-data folder. Pure fs (no Electron), so it is unit-tested.
// Owned by lane C.
import fs from 'node:fs';
import path from 'node:path';
import type { RecentFile } from '../shared/ipc';
import { packageName } from './packageIO';

export const MAX_RECENTS = 10;

export class RecentFiles {
  constructor(
    private readonly file: string,
    private readonly limit = MAX_RECENTS,
  ) {}

  /** Newest first. Packages that no longer exist are dropped. */
  list(): RecentFile[] {
    let paths: string[] = [];
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8')) as { paths?: unknown };
      if (Array.isArray(parsed.paths)) paths = parsed.paths.filter((p): p is string => typeof p === 'string');
    } catch {
      /* no list yet, or unreadable: start empty */
    }
    return paths.filter((p) => fs.existsSync(path.join(p, 'document.json'))).map((p) => ({ path: p, name: packageName(p) }));
  }

  add(packagePath: string): RecentFile[] {
    const abs = path.resolve(packagePath);
    const next = [abs, ...this.list().map((r) => r.path).filter((p) => p !== abs)].slice(0, this.limit);
    return this.write(next);
  }

  clear(): RecentFile[] {
    return this.write([]);
  }

  private write(paths: string[]): RecentFile[] {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify({ paths }, null, 2) + '\n', 'utf8');
    } catch {
      /* a read-only profile folder must not break opening a document */
    }
    return paths.map((p) => ({ path: p, name: packageName(p) }));
  }
}
