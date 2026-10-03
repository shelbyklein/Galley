import { createId, isBuiltinSwatch, swatchSchema, type GalleyDocument, type Swatch } from '@galley/model';
import { z } from 'zod';

export const SWATCH_LIBRARY_MAX_BYTES = 1 << 20;
const librarySchema = z.strictObject({
  format: z.literal('galley-swatch-library'),
  version: z.literal(1),
  swatches: z.array(swatchSchema).max(1000),
});
export type SwatchLibrary = z.infer<typeof librarySchema>;

/** Validate the entire dependency graph before any import command or disk write. */
export function parseSwatchLibrary(input: unknown): SwatchLibrary {
  const parsed = librarySchema.safeParse(input);
  if (!parsed.success) throw new Error('Invalid swatch library. Expected Galley library version 1 with valid CMYK, spot and tint definitions.');
  const library = parsed.data;
  const ids = new Map<string, Swatch>();
  const names = new Set<string>();
  for (const swatch of library.swatches) {
    if (ids.has(swatch.id) || names.has(swatch.name)) throw new Error('Invalid swatch library: duplicate swatch id or name.');
    if (swatch.name.length > 200 || /[\x00-\x1f\x7f]/.test(swatch.name)) throw new Error('Invalid swatch library: color names must be printable and at most 200 characters.');
    ids.set(swatch.id, swatch); names.add(swatch.name);
  }
  for (const swatch of library.swatches) {
    if (swatch.type === 'tint') {
      const base = ids.get(swatch.baseId);
      if (!base || base.type === 'tint') throw new Error(`Invalid swatch library: tint “${swatch.name}” needs a CMYK or spot base in the library.`);
    }
  }
  return library;
}

/** Export document colors and any built-in bases needed by their tints. Built-ins alone are not a library. */
export function documentSwatchLibrary(doc: GalleyDocument): SwatchLibrary {
  const include = new Set(doc.swatchOrder.filter((id) => !isBuiltinSwatch(id)));
  for (const id of include) {
    const swatch = doc.swatches[id]!;
    if (swatch.type === 'tint') include.add(swatch.baseId);
  }
  return parseSwatchLibrary({ format: 'galley-swatch-library', version: 1, swatches: doc.swatchOrder.filter((id) => include.has(id)).map((id) => doc.swatches[id]!) });
}

function equalDefinition(a: Swatch, b: Swatch): boolean {
  if (a.type !== b.type) return false;
  return a.type === 'tint' && b.type === 'tint' ? a.baseId === b.baseId && a.percent === b.percent
    : a.type !== 'tint' && b.type !== 'tint' && a.values.every((v, i) => v === b.values[i]);
}

/** Collision-safe, print-aware plan. Existing colors are read only; all new ids and tint bases are remapped. */
export function prepareSwatchImport(doc: GalleyDocument, input: unknown, makeId: () => string = () => createId('swatch')): { additions: Swatch[]; reused: number } {
  const library = parseSwatchLibrary(input);
  const byName = new Map(Object.values(doc.swatches).map((swatch) => [swatch.name, swatch]));
  const usedIds = new Set(Object.keys(doc.swatches));
  const mapped = new Map<string, string>();
  const additions: Swatch[] = [];
  let reused = 0;
  const importOne = (source: Swatch) => {
    const candidate: Swatch = source.type === 'tint' ? { ...source, baseId: mapped.get(source.baseId)! } : { ...source, values: [...source.values] };
    const existing = byName.get(source.name);
    if (existing && equalDefinition(existing, candidate)) { mapped.set(source.id, existing.id); reused++; return; }
    if (existing && (existing.type === 'spot' || source.type === 'spot')) throw new Error(`Cannot import “${source.name}”: its spot ink name conflicts with an existing color. Rename or correct the library definition first.`);
    let name = source.name;
    for (let n = 2; byName.has(name); n++) { const suffix = ` ${n}`; name = source.name.slice(0, 200 - suffix.length) + suffix; }
    let id: string;
    do { id = makeId(); } while (usedIds.has(id));
    usedIds.add(id);
    const swatch = { ...candidate, id, name };
    mapped.set(source.id, id); byName.set(name, swatch); additions.push(swatch);
  };
  library.swatches.filter((s) => s.type !== 'tint').forEach(importOne);
  library.swatches.filter((s) => s.type === 'tint').forEach(importOne);
  return { additions, reused };
}
