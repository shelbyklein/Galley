import { app, ipcMain, protocol } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { groupFontFamilies, resolveFontFace, scanFontFolders, fontFiles, type FontBinding, type FontFamilyInfo, type FontRequest } from '@galley/fonts';
import { instanceFont, sfntBytes, instanceAxes } from '@galley/fonts/instance';
import { getActivePackage } from '../package';
const require = createRequire(`${process.cwd()}/package.json`);
export const FONT_SCHEME = 'galley-font';
const files = new Map<string, { path?: string; bytes?: Buffer }>();
let system: ReturnType<typeof scanFontFolders> | undefined;
let documentSignature = '';
let documentFaces: ReturnType<typeof scanFontFolders> = [];

export function registerFontScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: FONT_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
}

export function fontFamilies(): FontFamilyInfo[] {
  system ??= scanFontFolders([
    { path: '/System/Library/Fonts', source: 'system' }, { path: '/Library/Fonts', source: 'system' },
    { path: path.join(os.homedir(), 'Library/Fonts'), source: 'system' },
    { path: path.dirname(require.resolve('@fontsource/inter/package.json')) + '/files', source: 'bundled' },
  ], path.join(app.getPath('userData'), 'font-cache-v3.json')).filter((face) => (face.source !== 'bundled' || /inter-latin-\d+-/.test(path.basename(face.path))) && (face.source !== 'system' || !face.family.startsWith('.')));
  const folder = getActivePackage() ? path.join(getActivePackage()!, 'fonts') : '';
  // Inspect folder signatures as well as its name: externally restored/replaced package fonts must reload.
  const docFiles = folder ? fontFiles(folder).map((file) => { try { const s = fs.statSync(file); return `${file}:${s.size}:${s.mtimeMs}`; } catch { return `${file}:missing`; } }).join('|') : '';
  const signature = `${folder}:${docFiles}`;
  if (signature !== documentSignature) {
    documentSignature = signature;
    documentFaces = folder ? scanFontFolders([{ path: folder, source: 'document' }]) : [];
  }
  return groupFontFamilies([...documentFaces, ...system]);
}

export async function resolveFonts(requests: FontRequest[], exporting = false): Promise<FontBinding[]> {
  const families = fontFamilies();
  const bindings: FontBinding[] = [];
  for (const request of requests) {
    const { face, missing } = resolveFontFace(families, request);
    if (exporting && !face.embeddable) throw new Error(`Cannot export ${request.family} ${face.styleName}: ${face.embeddingReason}. Replace this font with one that permits outline embedding and subsetting.`);
    const axes = face.format === 'variable' ? instanceAxes(face, request) : undefined;
    const key = createHash('sha256').update(`${face.id}:${axes && face.embeddable ? JSON.stringify(axes) : 'screen'}`).digest('hex');
    if (!files.has(key)) {
      if (axes && face.embeddable) files.set(key, { bytes: await instanceFont(face, request) });
      else if (/\.(ttc|otc)$/i.test(face.path)) files.set(key, { bytes: await sfntBytes(face) });
      else files.set(key, { path: face.path });
    }
    bindings.push({ ...request, face, missing, url: `${FONT_SCHEME}://face/${key}`, ...(axes && face.embeddable ? { instanceAxes: axes } : {}) });
  }
  return bindings;
}

export function registerFontHandlers(): void {
  ipcMain.handle('galley:font-families', () => fontFamilies());
  ipcMain.handle('galley:font-resolve', (_event, requests: FontRequest[]) => resolveFonts(requests));
  protocol.handle(FONT_SCHEME, (request) => {
    const key = new URL(request.url).pathname.replace(/^\//, '');
    const file = files.get(key);
    if (!file) return new Response('Unknown font', { status: 404 });
    const bytes = file.bytes ?? fs.readFileSync(file.path!);
    // A capability URL serves only scanned/registered files, never arbitrary renderer-supplied paths.
    return new Response(new Uint8Array(bytes), { headers: { 'content-type': 'font/otf', 'access-control-allow-origin': '*', 'cache-control': 'no-store' } });
  });
  if (process.env.GALLEY_E2E === '1') (globalThis as { __galleyFonts?: unknown }).__galleyFonts = { fontFamilies, resolveFonts };
}
