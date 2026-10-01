// Lengths at the UI edge. The model stores points; fields show a unit and accept any unit the user types.
// `displayUnit()` is the one place the control strip asks which unit to show: it is points today, and the hook for the
// ruler units lane B adds (`view.units.*`).
import { PT_PER_IN, PT_PER_MM, PT_PER_PICA } from '@galley/model';

export type DisplayUnit = 'pt' | 'in' | 'mm';

const PT_PER_UNIT: Record<string, number> = {
  pt: 1,
  in: PT_PER_IN,
  '"': PT_PER_IN,
  mm: PT_PER_MM,
  cm: PT_PER_MM * 10,
  p: PT_PER_PICA,
  pica: PT_PER_PICA,
  picas: PT_PER_PICA,
};

const DIGITS: Record<DisplayUnit, number> = { pt: 3, in: 4, mm: 3 };

/** The unit the control strip and dialogs show lengths in. */
export function displayUnit(): DisplayUnit {
  return 'pt';
}

/** A number with float noise trimmed and no trailing zeros: `36`, `36.3`, `0.125`. */
export function trimNumber(value: number, digits: number): string {
  const f = 10 ** digits;
  const rounded = Math.round(value * f) / f;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

/** A bare number in `unit`, for a field that shows the unit separately. */
export function formatNumber(pt: number, unit: DisplayUnit = 'pt'): string {
  return trimNumber(pt / PT_PER_UNIT[unit]!, DIGITS[unit]);
}

/** `36 pt`, `0.5 in`, `12.7 mm`. */
export function formatLength(pt: number, unit: DisplayUnit = 'pt'): string {
  return `${formatNumber(pt, unit)} ${unit}`;
}

/** An angle: `0°`, `-12.5°`. */
export function formatAngle(deg: number): string {
  return `${trimNumber(deg, 3)}°`;
}

const LENGTH = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*([a-z"]*)\s*$/i;

/**
 * Parse what the user typed into a length field: `72`, `1.5 in`, `10mm`, `3p` (picas), `0.5"`. A bare number is in
 * `defaultUnit`. Returns points, or null when the text is not a length.
 */
export function parseLength(text: string, defaultUnit: DisplayUnit = 'pt'): number | null {
  const m = LENGTH.exec(text);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const unit = m[2]!.toLowerCase() === '' ? defaultUnit : m[2]!.toLowerCase();
  const factor = PT_PER_UNIT[unit];
  return factor === undefined ? null : n * factor;
}

/** Parse an angle in degrees: `45`, `-90°`, `12.5 deg`. */
export function parseAngle(text: string): number | null {
  const m = /^\s*([+-]?(?:\d+\.?\d*|\.\d+))\s*(?:°|deg)?\s*$/i.exec(text);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/** A percentage: `75`, `75%`. Clamped to 0..100 by the caller. */
export function parsePercent(text: string): number | null {
  const m = /^\s*([+-]?(?:\d+\.?\d*|\.\d+))\s*%?\s*$/.exec(text);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}
