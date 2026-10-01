import { z } from 'zod';
import { idSchema, type Id } from './ids';
import { percentSchema } from './units';

/** Ink values: cyan, magenta, yellow, black as percentages. */
export const cmykSchema = z.tuple([percentSchema, percentSchema, percentSchema, percentSchema]);
export type Cmyk = z.infer<typeof cmykSchema>;

const swatchBase = { id: idSchema, name: z.string().trim().min(1) };

/** A process color. */
export const cmykSwatchSchema = z.strictObject({ ...swatchBase, type: z.literal('cmyk'), values: cmykSchema });
/**
 * A spot color: its own plate, named by `name` (for example `PANTONE 185 C`). `values` is the CMYK alternate used for
 * on-screen display and for viewers that do not support separations.
 */
export const spotSwatchSchema = z.strictObject({ ...swatchBase, type: z.literal('spot'), values: cmykSchema });
/** A saved tint of another swatch (which must be a cmyk or spot swatch, not another tint). */
export const tintSwatchSchema = z.strictObject({
  ...swatchBase,
  type: z.literal('tint'),
  baseId: idSchema,
  percent: percentSchema,
});

export const swatchSchema = z.discriminatedUnion('type', [cmykSwatchSchema, spotSwatchSchema, tintSwatchSchema]);
export type Swatch = z.infer<typeof swatchSchema>;
export type CmykSwatch = z.infer<typeof cmykSwatchSchema>;
export type SpotSwatch = z.infer<typeof spotSwatchSchema>;
export type TintSwatch = z.infer<typeof tintSwatchSchema>;

/** Built-in swatches every document has. They cannot be removed or edited. `[None]` is a `null` paint, not a swatch. */
export const SWATCH_PAPER: Id = 'paper';
export const SWATCH_BLACK: Id = 'black';
export const SWATCH_REGISTRATION: Id = 'registration';
export const BUILTIN_SWATCH_IDS: readonly Id[] = [SWATCH_PAPER, SWATCH_BLACK, SWATCH_REGISTRATION];

export function isBuiltinSwatch(id: Id): boolean {
  return BUILTIN_SWATCH_IDS.includes(id);
}

export function builtinSwatches(): Record<Id, Swatch> {
  return {
    [SWATCH_PAPER]: { id: SWATCH_PAPER, name: '[Paper]', type: 'cmyk', values: [0, 0, 0, 0] },
    [SWATCH_BLACK]: { id: SWATCH_BLACK, name: '[Black]', type: 'cmyk', values: [0, 0, 0, 100] },
    [SWATCH_REGISTRATION]: { id: SWATCH_REGISTRATION, name: '[Registration]', type: 'cmyk', values: [100, 100, 100, 100] },
  };
}

/** A paint: a swatch applied at a tint, optionally overprinting. A fill or stroke that is `null` is `[None]`. */
export const paintSchema = z.strictObject({
  swatchId: idSchema,
  /** Percent of the swatch, 0 to 100. Multiplies with a tint swatch's own percent. */
  tint: percentSchema,
  overprint: z.boolean(),
});
export type Paint = z.infer<typeof paintSchema>;

export function paint(swatchId: Id, tint = 100, overprint = false): Paint {
  return { swatchId, tint, overprint };
}

export const strokeSchema = z.strictObject({
  paint: paintSchema,
  /** Weight in points. Strokes are centered on the frame edge. */
  weight: z.number().min(0),
});
export type Stroke = z.infer<typeof strokeSchema>;
