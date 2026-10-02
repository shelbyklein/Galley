/**
 * Text wrap: how text in OTHER frames flows around a frame. Stored on any box frame (`textWrap`); absent means none.
 * Used by the thread engine in P2-09 (invisible `shape-outside` floats, one-sided for now); P2-01 only stores it.
 *
 *   none         the frame does not push text away. Absent and `{ mode: 'none' }` mean the same; commands store absence.
 *   boundingBox  text stays outside the frame's (rotated) bounding box plus the offsets: top, right, bottom, left, points.
 *   contour      text follows the frame's outline plus one offset all round. Only an ellipse has a contour for now; on any
 *                other frame it behaves like boundingBox with that offset on every side.
 */
import { z } from 'zod';
import { sizeSchema } from '../units';

export const textWrapOffsetsSchema = z.strictObject({ top: sizeSchema, right: sizeSchema, bottom: sizeSchema, left: sizeSchema });

export const textWrapSchema = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('none') }),
  z.strictObject({ mode: z.literal('boundingBox'), offsets: textWrapOffsetsSchema }),
  z.strictObject({ mode: z.literal('contour'), offset: sizeSchema }),
]);
export type TextWrap = z.infer<typeof textWrapSchema>;

/** The wrap a frame effectively has (`none` when it has none). */
export function wrapOf(frame: { textWrap?: TextWrap | undefined }): TextWrap {
  return frame.textWrap ?? { mode: 'none' };
}
