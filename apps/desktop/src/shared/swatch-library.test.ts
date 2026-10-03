import { describe, expect, it } from 'vitest';
import { addSwatch, applyCommand, createDocument, createHistory, createSequentialIds, type Swatch } from '@galley/model';
import { documentSwatchLibrary, parseSwatchLibrary, prepareSwatchImport } from './swatch-library';

const blank = () => createDocument({ title: 'Library', engineVersion: 'test' });
const colors: Swatch[] = [
  { id: 'shade', type: 'tint', name: 'Studio Ink 40%', baseId: 'ink', percent: 40 },
  { id: 'process', type: 'cmyk', name: 'Studio Blue', values: [100, 40, 0, 15] },
  { id: 'ink', type: 'spot', name: 'Studio Ink', values: [0, 90, 40, 0] },
];
const library = (swatches = colors) => ({ format: 'galley-swatch-library', version: 1, swatches });

describe('user swatch libraries', () => {
  it('remaps all ids and tint dependencies, even when a tint precedes its base', () => {
    const makeId = createSequentialIds();
    const result = prepareSwatchImport(blank(), library(), () => makeId('sw'));
    expect(result.additions.map((s) => s.id)).toEqual(['sw_1', 'sw_2', 'sw_3']);
    expect(result.additions[2]).toMatchObject({ type: 'tint', baseId: 'sw_2', percent: 40 });
  });
  it('round-trips process, spot and tint definitions and reuses identical inks without new plates', () => {
    let h = createHistory(blank());
    for (const swatch of [...colors.filter((s) => s.type !== 'tint'), ...colors.filter((s) => s.type === 'tint')]) h = applyCommand(h, addSwatch, { swatch });
    const saved = documentSwatchLibrary(h.doc);
    expect(parseSwatchLibrary(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
    expect(prepareSwatchImport(h.doc, saved)).toEqual({ additions: [], reused: 3 });
  });
  it('includes and reuses built-in dependencies without exporting unrelated built-ins', () => {
    const h = applyCommand(createHistory(blank()), addSwatch, { swatch: { id: 'gray', type: 'tint', name: 'Gray 30%', baseId: 'black', percent: 30 } });
    const saved = documentSwatchLibrary(h.doc);
    expect(saved.swatches.map((s) => s.id)).toEqual(['black', 'gray']);
    const result = prepareSwatchImport(blank(), saved);
    expect(result.reused).toBe(1);
    expect(result.additions[0]).toMatchObject({ type: 'tint', baseId: 'black', percent: 30 });
  });
  it('never overwrites existing ids or colors and suffixes ordinary color-name collisions', () => {
    const existing: Swatch = { id: 'process', name: 'Studio Blue', type: 'cmyk', values: [0, 0, 0, 100] };
    const h = applyCommand(createHistory(blank()), addSwatch, { swatch: existing });
    const before = JSON.stringify(h.doc);
    const result = prepareSwatchImport(h.doc, library());
    expect(result.additions.find((s) => s.type === 'cmyk')).toMatchObject({ name: 'Studio Blue 2', values: [100, 40, 0, 15] });
    expect(result.additions.every((s) => !h.doc.swatches[s.id])).toBe(true);
    expect(JSON.stringify(h.doc)).toBe(before);
  });
  it('rejects conflicting spot names atomically, including process/spot collisions', () => {
    for (const swatch of [
      { ...colors[2]!, values: [0, 20, 40, 0] } as Swatch,
      { id: 'existing', name: 'Studio Ink', type: 'cmyk', values: [0, 90, 40, 0] } as Swatch,
    ]) {
      const h = applyCommand(createHistory(blank()), addSwatch, { swatch });
      const before = JSON.stringify(h.doc);
      expect(() => prepareSwatchImport(h.doc, library())).toThrow(/spot ink name conflicts/);
      expect(JSON.stringify(h.doc)).toBe(before);
    }
  });
  it('rejects malformed versions, values, duplicates and missing or tint bases', () => {
    const invalid: unknown[] = [
      { ...library(), version: 2 }, { ...library(), extra: true },
      library([{ ...colors[1]!, values: [101, 0, 0, 0] } as Swatch]),
      library([{ ...colors[1]!, values: [Infinity, 0, 0, 0] } as Swatch]),
      library([colors[1]!, colors[1]!]), library([colors[0]!]),
      library([{ id: 'base', name: 'Base', type: 'tint', baseId: 'shade', percent: 20 }, { id: 'shade', name: 'Shade', type: 'tint', baseId: 'base', percent: 40 }]),
    ];
    for (const input of invalid) expect(() => parseSwatchLibrary(input)).toThrow(/Invalid swatch library/);
  });
});
