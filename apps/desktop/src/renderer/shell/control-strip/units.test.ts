import { describe, expect, it } from 'vitest';
import { formatAngle, formatLength, formatNumber, parseAngle, parseLength, parsePercent, trimNumber } from './units';

describe('formatting lengths', () => {
  it('trims float noise and trailing zeros', () => {
    expect(formatLength(36)).toBe('36 pt');
    expect(formatLength(36.3)).toBe('36.3 pt');
    expect(formatLength(0.1 + 0.2)).toBe('0.3 pt');
    expect(formatLength(595.2755905511812)).toBe('595.276 pt');
    expect(formatLength(-0)).toBe('0 pt');
  });

  it('shows other units', () => {
    expect(formatLength(72, 'in')).toBe('1 in');
    expect(formatLength(9, 'in')).toBe('0.125 in');
    expect(formatNumber((210 * 72) / 25.4, 'mm')).toBe('210');
  });

  it('formats angles', () => {
    expect(formatAngle(0)).toBe('0°');
    expect(formatAngle(-12.5)).toBe('-12.5°');
    expect(trimNumber(1 / 3, 3)).toBe('0.333');
  });
});

describe('parsing what the user types', () => {
  it('reads a bare number in the default unit', () => {
    expect(parseLength('72')).toBe(72);
    expect(parseLength(' 72.5 ')).toBe(72.5);
    expect(parseLength('1', 'in')).toBe(72);
    expect(parseLength('-3')).toBe(-3);
  });

  it('reads a unit after the number', () => {
    expect(parseLength('1 in')).toBe(72);
    expect(parseLength('0.5"')).toBe(36);
    expect(parseLength('10mm')).toBeCloseTo((10 * 72) / 25.4, 10);
    expect(parseLength('1cm')).toBeCloseTo((10 * 72) / 25.4, 10);
    expect(parseLength('3p')).toBe(36);
    expect(parseLength('12 PT')).toBe(12);
  });

  it('rejects text that is not a length', () => {
    expect(parseLength('')).toBeNull();
    expect(parseLength('abc')).toBeNull();
    expect(parseLength('12 furlongs')).toBeNull();
    expect(parseLength('1,5')).toBeNull();
  });

  it('parses angles and percentages', () => {
    expect(parseAngle('45')).toBe(45);
    expect(parseAngle('-90°')).toBe(-90);
    expect(parseAngle('12.5 deg')).toBe(12.5);
    expect(parseAngle('x')).toBeNull();
    expect(parsePercent('75%')).toBe(75);
    expect(parsePercent('75')).toBe(75);
    expect(parsePercent('lots')).toBeNull();
  });

  it('format then parse returns the same points', () => {
    for (const pt of [0, 36, 36.3, 100.1, 612, 1224, 0.75]) expect(parseLength(formatLength(pt))).toBeCloseTo(pt, 3);
  });
});
