/**
 * The Galley document model, v1 (`formatVersion: 1`). One zod schema per object; the TypeScript types are inferred
 * from the schemas, so the file format and the types cannot drift apart.
 *
 * Shape (everything is stored by id, in flat records; ordering lives in explicit arrays):
 *
 *   document
 *     meta                 title, engineVersion (Electron version that last saved it), colorProfile
 *     pageOrder, pages     pages: size, margins, columns, bleed, slug, and `items` (top-level frame ids, z-order)
 *     layerOrder, layers   bottom to top
 *     swatchOrder, swatches   cmyk | spot | tint
 *     frames               rect | ellipse | line | text | image | group
 *     stories              one per text frame
 *     assets               linked images (path + hash live in links.json on disk)
 *     guides               ruler guides, positioned on a page
 *
 * Stacking order. A page's `items` lists its top-level frames bottom to top. Frames are painted layer by layer
 * (`layerOrder`, bottom first); within a layer, in `items` order. A group lists its children bottom to top in
 * `childIds`; a child is never in any `items`. Every frame is reachable exactly once from some page. Rules the type
 * system cannot express (dangling ids, one placement per frame, ...) are checked by `validateDocument` (./validate.ts).
 *
 * Geometry. `x`, `y` are the top-left of the frame's unrotated box in points, relative to the top-left of its page's
 * trim box (so bleed objects have negative coordinates). `rotation` is degrees, clockwise, about the box center. A
 * group has no geometry of its own; its bounds are those of its children (`boundsOf` in ./queries.ts). A line runs
 * horizontally through the middle of its box from (x, y + h/2) to (x + w, y + h/2); draw it at any angle with
 * `rotation`, and keep `h` at 0.
 */
import { z } from 'zod';
import { idSchema, type Id } from './ids';
import { paintSchema, strokeSchema, swatchSchema } from './swatch';
import { storySchema } from './text/story';
import { positiveSchema, ptSchema, sizeSchema } from './units';

export const FORMAT_VERSION = 1;

// ---------------------------------------------------------------------------------------------------------------- pages

export const insetsSchema = z.strictObject({ top: sizeSchema, right: sizeSchema, bottom: sizeSchema, left: sizeSchema });
export type Insets = z.infer<typeof insetsSchema>;

export const columnsSchema = z.strictObject({
  count: z.number().int().min(1).max(64),
  /** Space between columns in points. */
  gutter: sizeSchema,
});
export type Columns = z.infer<typeof columnsSchema>;

export const pageSchema = z
  .strictObject({
    id: idSchema,
    /** Trim size in points. */
    width: positiveSchema,
    height: positiveSchema,
    margins: insetsSchema,
    columns: columnsSchema,
    /** Bleed: distance beyond the trim edge that art must reach. */
    bleed: insetsSchema,
    /**
     * Slug: distance from the trim edge to the outer edge of the printed sheet (marks, color bars and notes live
     * there). It includes the bleed, so the sheet extends `max(bleed, slug)` beyond trim on each side.
     */
    slug: insetsSchema,
    /** Top-level frame ids on this page, bottom to top. */
    items: z.array(idSchema),
  })
  .refine((p) => p.margins.left + p.margins.right < p.width && p.margins.top + p.margins.bottom < p.height, {
    message: 'margins must leave room for content',
    path: ['margins'],
  })
  .refine((p) => p.columns.gutter * (p.columns.count - 1) < p.width - p.margins.left - p.margins.right, {
    message: 'column gutters must leave room for columns',
    path: ['columns'],
  });
export type Page = z.infer<typeof pageSchema>;

// --------------------------------------------------------------------------------------------------------------- layers

export const layerSchema = z.strictObject({
  id: idSchema,
  name: z.string().trim().min(1),
  /** `#rrggbb`, used by the editor for selection handles and the Layers panel. Not a print color. */
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'must be #rrggbb'),
  visible: z.boolean(),
  locked: z.boolean(),
});
export type Layer = z.infer<typeof layerSchema>;

// -------------------------------------------------------------------------------------------------------------- guides

export const guideSchema = z.strictObject({
  id: idSchema,
  orientation: z.enum(['horizontal', 'vertical']),
  /** Points from the page's trim top (horizontal guide) or trim left (vertical guide). */
  position: ptSchema,
  pageId: idSchema,
});
export type Guide = z.infer<typeof guideSchema>;

// -------------------------------------------------------------------------------------------------------------- assets

/** A path inside the package: relative, forward slashes, no `..`, no leading slash. */
export const relativePathSchema = z
  .string()
  .min(1)
  .refine((p) => !p.startsWith('/') && !/^[A-Za-z]:/.test(p) && !p.includes('\\'), 'must be a relative posix path')
  .refine((p) => !p.split('/').some((seg) => seg === '..' || seg === '' || seg === '.'), 'must not contain ., .. or empty segments');

export const hashSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/, 'must be sha256:<64 hex digits>');

/** What an asset is, independent of where its file is. Stored in document.json. */
export const assetIntrinsicSchema = z.strictObject({
  id: idSchema,
  kind: z.literal('image'),
  /** Pixel size of the image. */
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  /** Native resolution recorded in the file, pixels per inch. */
  ppi: positiveSchema,
  colorSpace: z.enum(['rgb', 'cmyk', 'gray']),
});
/** Where an asset's file lives and how to detect that it changed. Stored in links.json. */
export const assetLinkSchema = z.strictObject({ path: relativePathSchema, hash: hashSchema });

export const assetSchema = z.strictObject({ ...assetIntrinsicSchema.shape, ...assetLinkSchema.shape });
export type Asset = z.infer<typeof assetSchema>;
export type AssetIntrinsic = z.infer<typeof assetIntrinsicSchema>;
export type AssetLink = z.infer<typeof assetLinkSchema>;

// -------------------------------------------------------------------------------------------------------------- frames

const frameCommon = {
  id: idSchema,
  /** User-visible object name; empty means "derive a label from the content" (the Layers panel does). */
  name: z.string(),
  layerId: idSchema,
};

const frameBox = {
  x: ptSchema,
  y: ptSchema,
  w: sizeSchema,
  h: sizeSchema,
  /** Degrees clockwise about the center of the box. */
  rotation: ptSchema,
  /** `null` is [None]. */
  fill: paintSchema.nullable(),
  stroke: strokeSchema.nullable(),
};

export const rectFrameSchema = z.strictObject({ ...frameCommon, ...frameBox, type: z.literal('rect') });
export const ellipseFrameSchema = z.strictObject({ ...frameCommon, ...frameBox, type: z.literal('ellipse') });
/** See the header comment for how a line is positioned. `fill` is ignored. */
export const lineFrameSchema = z.strictObject({ ...frameCommon, ...frameBox, type: z.literal('line') });

export const textFrameSchema = z.strictObject({
  ...frameCommon,
  ...frameBox,
  type: z.literal('text'),
  /** The frame's story. Exactly one frame per story in Phase 1; Phase 2 adds threads. */
  storyId: idSchema,
  /** Space between the frame edge and the text on all four sides, points. */
  inset: sizeSchema,
});

/**
 * Where the image sits inside its frame: the displayed rectangle of the whole image in points, relative to the
 * frame's top-left (unrotated). Fitting options just choose this rectangle; effective ppi is `asset.width / (w / 72)`.
 */
export const imageContentSchema = z.strictObject({ x: ptSchema, y: ptSchema, w: positiveSchema, h: positiveSchema });
export type ImageContent = z.infer<typeof imageContentSchema>;

export const imageFrameSchema = z
  .strictObject({
    ...frameCommon,
    ...frameBox,
    type: z.literal('image'),
    /** `null` is an empty graphic frame (drawn with an X in the editor, nothing in the export). */
    assetId: idSchema.nullable(),
    content: imageContentSchema.nullable(),
  })
  .refine((f) => (f.assetId === null) === (f.content === null), {
    message: 'assetId and content must both be set or both be null',
    path: ['content'],
  });

export const groupFrameSchema = z.strictObject({
  ...frameCommon,
  type: z.literal('group'),
  /** Children, bottom to top. They share the group's layer. */
  childIds: z.array(idSchema),
});

export const frameSchema = z.discriminatedUnion('type', [
  rectFrameSchema,
  ellipseFrameSchema,
  lineFrameSchema,
  textFrameSchema,
  imageFrameSchema,
  groupFrameSchema,
]);
export type Frame = z.infer<typeof frameSchema>;
export type RectFrame = z.infer<typeof rectFrameSchema>;
export type EllipseFrame = z.infer<typeof ellipseFrameSchema>;
export type LineFrame = z.infer<typeof lineFrameSchema>;
export type TextFrame = z.infer<typeof textFrameSchema>;
export type ImageFrame = z.infer<typeof imageFrameSchema>;
export type GroupFrame = z.infer<typeof groupFrameSchema>;
/** Every frame except a group: the ones with a box, a fill and a stroke. */
export type BoxFrame = Exclude<Frame, GroupFrame>;

export type FrameType = Frame['type'];

export function isBoxFrame(frame: Frame): frame is BoxFrame {
  return frame.type !== 'group';
}

// ----------------------------------------------------------------------------------------------------------- document

export const metaSchema = z.strictObject({
  title: z.string(),
  /**
   * The Electron version whose Chromium laid out this document's text when it was last saved (for example `44.5.1`).
   * Line breaks can change between Chromium versions; the app warns when this differs from the running engine.
   * Stamped on save; commands never touch it.
   */
  engineVersion: z.string().min(1),
  /** Name of the output profile the document soft-proofs against; `null` means the app default. */
  colorProfile: z.string().nullable(),
});
export type Meta = z.infer<typeof metaSchema>;

export const documentSchema = z.strictObject({
  formatVersion: z.literal(FORMAT_VERSION),
  meta: metaSchema,
  pageOrder: z.array(idSchema),
  pages: z.record(idSchema, pageSchema),
  layerOrder: z.array(idSchema),
  layers: z.record(idSchema, layerSchema),
  swatchOrder: z.array(idSchema),
  swatches: z.record(idSchema, swatchSchema),
  frames: z.record(idSchema, frameSchema),
  stories: z.record(idSchema, storySchema),
  assets: z.record(idSchema, assetSchema),
  guides: z.record(idSchema, guideSchema),
});
export type GalleyDocument = z.infer<typeof documentSchema>;

export type { Id };
