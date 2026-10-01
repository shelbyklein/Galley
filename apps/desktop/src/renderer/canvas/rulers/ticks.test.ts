import { describe, expect, it } from 'vitest';
import { formatUnitValue, fromUnits, majorStep, MIN_MAJOR_PX, rulerTicks, toUnits } from './ticks';

describe('ruler ticks', () => {
  it('chooses a major step that is at least MIN_MAJOR_PX apart', () => {
    for (const units of ['pt', 'in', 'mm'] as const) {
      for (const zoom of [0.05, 0.13, 0.5, 1, 2.5, 16, 40]) {
        const pxPerUnit = zoom * (units === 'pt' ? 1 : units === 'in' ? 72 : 72 / 25.4);
        expect(majorStep(zoom, units) * pxPerUnit).toBeGreaterThanOrEqual(MIN_MAJOR_PX);
      }
    }
  });

  it('uses 1, 2 or 5 times a power of ten', () => {
    for (const zoom of [0.07, 0.3, 1, 3.3, 12]) {
      const step = majorStep(zoom, 'pt');
      const mantissa = step / 10 ** Math.floor(Math.log10(step) + 1e-9);
      expect([1, 2, 5].some((m) => Math.abs(m - mantissa) < 1e-6)).toBe(true);
    }
  });

  it('labels inches at 100%', () => {
    const ticks = rulerTicks(0, 400, 1, 'in');
    const labels = ticks.filter((t) => t.label !== undefined && t.pt >= 0 && t.pt <= 400).map((t) => [t.pt, t.label]);
    expect(labels).toEqual([
      [0, '0'],
      [72, '1'],
      [144, '2'],
      [216, '3'],
      [288, '4'],
      [360, '5'],
    ]);
  });

  it('labels points at 100% every 100 pt and has minor ticks every 10 pt', () => {
    const ticks = rulerTicks(0, 300, 1, 'pt');
    expect(majorStep(1, 'pt')).toBe(100);
    expect(ticks.filter((t) => t.level === 0 && t.pt >= 0 && t.pt <= 300).map((t) => t.label)).toEqual(['0', '100', '200', '300']);
    expect(ticks.filter((t) => t.level === 2 && t.pt === 10)).toHaveLength(1);
    expect(ticks.filter((t) => t.level === 1 && t.pt === 50)).toHaveLength(1);
  });

  it('labels millimetres at 100% every 20 mm', () => {
    const mm = 72 / 25.4;
    const ticks = rulerTicks(0, 100 * mm, 1, 'mm');
    const labels = ticks.filter((t) => t.label !== undefined && t.pt >= -1e-9).map((t) => t.label);
    expect(labels.slice(0, 3)).toEqual(['0', '20', '40']);
  });

  it('places ticks exactly (no accumulated float error)', () => {
    const ticks = rulerTicks(0, 7200, 0.1, 'pt');
    for (const t of ticks) expect(Number.isInteger(t.pt)).toBe(true);
  });

  it('covers negative positions (bleed side of the origin)', () => {
    const ticks = rulerTicks(-150, 50, 1, 'pt');
    expect(ticks.some((t) => t.pt === -100 && t.label === '-100')).toBe(true);
    expect(ticks.some((t) => t.pt === 0 && t.label === '0')).toBe(true);
  });

  it('converts units and formats values', () => {
    expect(toUnits(72, 'in')).toBe(1);
    expect(fromUnits(1, 'in')).toBe(72);
    expect(toUnits(fromUnits(25.4, 'mm'), 'mm')).toBeCloseTo(25.4, 10);
    expect(formatUnitValue(0.1 + 0.2)).toBe('0.3');
    expect(formatUnitValue(12)).toBe('12');
    expect(formatUnitValue(-0)).toBe('0');
  });
});
