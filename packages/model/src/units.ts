import { z } from 'zod';

/**
 * Units: every length in the document model is a plain number of points (1 pt = 1/72 in), the native unit of PDF.
 * CSS `pt` maps one to one. Angles are degrees. Percentages (tint, ink values) are 0 to 100.
 * Display units (in, mm, picas) exist only at the UI edge; convert with the helpers below.
 */
export type Pt = number;

export const PT_PER_IN = 72;
export const PT_PER_MM = 72 / 25.4;
export const PT_PER_PICA = 12;

export const inches = (n: number): Pt => n * PT_PER_IN;
export const mm = (n: number): Pt => n * PT_PER_MM;
export const picas = (n: number): Pt => n * PT_PER_PICA;
export const toInches = (pt: Pt): number => pt / PT_PER_IN;
export const toMm = (pt: Pt): number => pt / PT_PER_MM;
export const toPicas = (pt: Pt): number => pt / PT_PER_PICA;

const MESSAGE = 'must be a number of points, not a string or unit';

/** A signed coordinate or offset in points. Rejects strings (`"72pt"`), NaN and Infinity. */
export const ptSchema = z.number({ error: MESSAGE });
/** A length in points that cannot be negative (sizes, insets, stroke weights). */
export const sizeSchema = z.number({ error: MESSAGE }).min(0);
/** A length in points that must be greater than zero (page dimensions). */
export const positiveSchema = z.number({ error: MESSAGE }).positive();
/** 0 to 100. */
export const percentSchema = z.number({ error: 'must be a number from 0 to 100' }).min(0).max(100);
