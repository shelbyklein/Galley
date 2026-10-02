/**
 * Ruler tick math, pure (unit-tested in ticks.test.ts). A ruler shows a span of page points as ticks in the display units
 * (pt, in, mm): a labelled major tick every 1, 2 or 5 x 10^k units (the smallest step that is at least MIN_MAJOR_PX apart
 * on screen), a half-step tick, and tenth-step ticks when they are at least MIN_MINOR_PX apart.
 */
import { PT_PER_IN, PT_PER_MM } from '@galley/model';
import type { DisplayUnits } from '../../store';

export const PT_PER_UNIT: Record<DisplayUnits, number> = { pt: 1, in: PT_PER_IN, mm: PT_PER_MM };

export const MIN_MAJOR_PX = 56;
export const MIN_MINOR_PX = 5;

/** 0 = major (labelled), 1 = half step, 2 = tenth step. */
export type TickLevel = 0 | 1 | 2;

export interface Tick {
  /** Page position in points. */
  pt: number;
  level: TickLevel;
  /** Present on major ticks. */
  label?: string;
}

export const toUnits = (pt: number, units: DisplayUnits): number => pt / PT_PER_UNIT[units];
export const fromUnits = (value: number, units: DisplayUnits): number => value * PT_PER_UNIT[units];

/** `36`, `0.5`, `12.7`: a ruler or field value without float noise or trailing zeros. */
export function formatUnitValue(value: number): string {
  const rounded = Math.round(value * 10000) / 10000;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

/** The major tick step in display units for this zoom (CSS px per pt). */
export function majorStep(zoom: number, units: DisplayUnits): number {
  const pxPerUnit = zoom * PT_PER_UNIT[units];
  for (let exp = -4; exp <= 8; exp++) {
    for (const m of [1, 2, 5]) {
      const step = m * 10 ** exp;
      if (step * pxPerUnit >= MIN_MAJOR_PX) return step;
    }
  }
  return 10 ** 8;
}

/**
 * The ticks that fall between page points `fromPt` and `toPt` (inclusive). Tick positions are computed as an integer
 * count of steps times the step, so they carry no accumulated float error.
 */
export function rulerTicks(fromPt: number, toPt: number, zoom: number, units: DisplayUnits): Tick[] {
  const step = majorStep(zoom, units);
  const unitPt = PT_PER_UNIT[units];
  const pxPerUnit = zoom * unitPt;
  const tenth = step / 10;
  const showTenth = tenth * pxPerUnit >= MIN_MINOR_PX;
  const sub = showTenth ? tenth : step / 2;
  // with tenths: every 10th tick is major, every 5th a half step; without: every 2nd is major and the rest half steps
  const levelOf = (i: number): TickLevel => (i % (showTenth ? 10 : 2) === 0 ? 0 : showTenth && i % 5 !== 0 ? 2 : 1);

  const first = Math.floor(toUnits(fromPt, units) / sub) - 1;
  const last = Math.ceil(toUnits(toPt, units) / sub) + 1;
  const ticks: Tick[] = [];
  for (let i = first; i <= last; i++) {
    const value = i * sub;
    const level = levelOf(i);
    const tick: Tick = { pt: value * unitPt, level };
    if (level === 0) tick.label = formatUnitValue(value);
    ticks.push(tick);
  }
  return ticks;
}
