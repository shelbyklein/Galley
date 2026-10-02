import { findFontFace } from './match';
import fs, { type Dirent } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import * as fontkit from 'fontkit';
import type { FontAxis, FontFaceInfo, FontFamilyInfo, FontRequest } from './types';
export type * from './types';

export function embeddingPermission(fsType: number): { embeddable: boolean; embeddingReason: string | null } {
  // Chromium subsets outline fonts. Preview-and-print (4) and editable (8) are allowed for PDF output.
  const embeddingReason = fsType & 2 ? 'Restricted license embedding' : fsType & 0x200 ? 'Bitmap-only embedding' : fsType & 0x100 ? 'No subsetting: Chromium cannot embed the complete font' : null;
  return { embeddable: embeddingReason === null, embeddingReason };
}

function faceMetadata(font: fontkit.Font, file: string, source: FontFaceInfo['source'], faceIndex: number): FontFaceInfo {
  const internal = font as unknown as { 'OS/2'?: { usWeightClass: number; fsType: Record<string, boolean>; fsSelection: { italic: boolean; oblique: boolean } }; directory: { tables: Record<string, unknown> }; italicAngle: number };
  const os2 = internal['OS/2'];
  const flags = os2?.fsType ?? {};
  const fsType = (flags.noEmbedding ? 2 : 0) | (flags.viewOnly ? 4 : 0) | (flags.editable ? 8 : 0) | (flags.noSubsetting ? 0x100 : 0) | (flags.bitmapOnly ? 0x200 : 0);
  const axes = Object.fromEntries(Object.entries(font.variationAxes ?? {}).filter((entry) => entry[1] !== undefined)) as Record<string, FontAxis>;
  const outlines = internal.directory.tables['CFF '] || internal.directory.tables.CFF2 ? 'cff' : 'truetype';
  const id = createHash('sha256').update(`${file}:${faceIndex}:${fs.statSync(file).mtimeMs}:${fs.statSync(file).size}`).digest('hex');
  return {
    id, path: file, faceIndex, source, family: font.getName('preferredFamily', 'en') || font.familyName, postscriptName: font.postscriptName,
    styleName: font.getName('preferredSubfamily', 'en') || font.subfamilyName || 'Regular', weight: Math.max(1, Math.min(1000, os2?.usWeightClass ?? 400)),
    style: os2?.fsSelection.italic || internal.italicAngle !== 0 ? 'italic' : 'normal',
    format: Object.keys(axes).length ? 'variable' : outlines === 'cff' ? 'cff' : path.extname(file).toLowerCase() === '.woff2' ? 'woff2' : 'truetype',
    outlines, axes, fsType, ...embeddingPermission(fsType),
  };
}

/** Logical style faces share one variable file; no custom-axis controls are introduced. */
function variableStyles(font: fontkit.Font, face: FontFaceInfo): FontFaceInfo[] {
  const axis = face.axes.wght;
  if (!axis) return [face];
  let named: Record<string, Record<string, number>> = {};
  try { named = (font as unknown as { namedVariations?: Record<string, Record<string, number>> }).namedVariations ?? {}; } catch { /* Some webfont subsets strip instance name records. */ }
  const supported = Object.entries(named).filter(([, values]) => Number.isFinite(values.wght) && Object.entries(values).every(([tag, value]) => tag === 'wght' || value === face.axes[tag]?.default));
  const defaults: [string, number][] = [['Thin', 100], ['Extra Light', 200], ['Light', 300], ['Regular', 400], ['Medium', 500], ['Semi Bold', 600], ['Bold', 700], ['Extra Bold', 800], ['Black', 900]];
  const styles = supported.length ? supported.map(([name, values]): [string, number] => [name, values.wght!]) : defaults;
  return [face, ...styles.filter(([, weight]) => weight >= axis.min && weight <= axis.max && weight !== face.weight).map(([styleName, weight]) => ({ ...face, styleName: face.style === 'italic' && !/italic/i.test(styleName) ? `${styleName} Italic` : styleName, weight: Math.round(weight) }))];
}

export function fontFiles(folder: string): string[] {
  let entries: Dirent[];
  try { entries = fs.readdirSync(folder, { withFileTypes: true }); } catch { return []; }
  return entries.flatMap((entry) => {
    const file = path.join(folder, entry.name);
    return entry.isDirectory() ? fontFiles(file) : entry.isFile() && /\.(ttf|otf|ttc|otc|woff2?)$/i.test(entry.name) ? [file] : [];
  }).sort();
}

/** Cache entries by file signature; corrupt/unreadable files never prevent other families appearing. */
export function scanFontFolders(folders: { path: string; source: FontFaceInfo['source'] }[], cachePath?: string): FontFaceInfo[] {
  let cache: Record<string, FontFaceInfo[]> = {};
  try { if (cachePath) cache = JSON.parse(fs.readFileSync(cachePath, 'utf8')); } catch { /* cold scan */ }
  const next: typeof cache = {};
  const all: FontFaceInfo[] = [];
  for (const folder of folders) for (const file of fontFiles(folder.path)) {
    try {
      const stat = fs.statSync(file);
      const key = `${file}:${stat.size}:${stat.mtimeMs}`;
      let faces = cache[key];
      if (!faces) {
        const opened = fontkit.openSync(file);
        const fonts = 'fonts' in opened ? opened.fonts : [opened];
        faces = fonts.flatMap((f, index) => variableStyles(f, faceMetadata(f, file, folder.source, index)));
      }
      next[key] = faces;
      all.push(...faces.map((face) => ({ ...face, source: folder.source })));
    } catch { /* unsupported resource-fork fonts or damaged font files are skipped */ }
  }
  if (cachePath) {
    try { fs.mkdirSync(path.dirname(cachePath), { recursive: true }); fs.writeFileSync(cachePath, JSON.stringify(next)); } catch { /* read-only user data: scan remains usable */ }
  }
  return all;
}

const priority = { document: 0, bundled: 1, system: 2 };
/** A document face wins over the installed face at the same weight/style. Other styles remain available. */
export function groupFontFamilies(faces: FontFaceInfo[]): FontFamilyInfo[] {
  const families = new Map<string, FontFamilyInfo>();
  for (const face of [...faces].sort((a, b) => priority[a.source] - priority[b.source] || a.path.localeCompare(b.path))) {
    const key = face.family.toLocaleLowerCase('en-US');
    const family = families.get(key) ?? { family: face.family, source: face.source, faces: [] };
    if (!family.faces.some((other) => other.weight === face.weight && other.style === face.style && JSON.stringify(other.axes) === JSON.stringify(face.axes))) family.faces.push(face);
    families.set(key, family);
  }
  return [...families.values()].map((family) => ({ ...family, faces: family.faces.sort((a, b) => a.weight - b.weight || a.style.localeCompare(b.style)) })).sort((a, b) => a.family.localeCompare(b.family));
}

export function resolveFontFace(families: FontFamilyInfo[], request: FontRequest): { face: FontFaceInfo; missing: boolean } {
  const face = findFontFace(families, request);
  if (face) return { face, missing: false };
  const fallback = families.find((f) => f.family === 'Inter')?.faces.find((f) => f.weight === 400 && f.style === 'normal');
  if (!fallback) throw new Error('The bundled Inter fallback is unavailable.');
  return { face: fallback, missing: true };
}
