import { createId, type Id } from './ids';
import type { BaselineGrid, GalleyDocument, Insets, Layer, Page } from './schema';
import { FORMAT_VERSION } from './schema';
import { builtinSwatches } from './swatch';
import { builtinCharacterStyles, builtinParagraphStyles } from './text/styles';

/** Equal insets on all four sides. */
export function uniformInsets(n: number): Insets {
  return { top: n, right: n, bottom: n, left: n };
}

export const DEFAULT_LAYER_COLOR = '#4da3ff';

/** InDesign's default baseline grid: a line every 12 pt from the top of the page. */
export const DEFAULT_BASELINE_GRID: BaselineGrid = { start: 0, increment: 12 };

export interface PageSpec {
  id?: Id;
  /** Trim size, points. Default US Letter, 612 x 792. */
  width?: number;
  height?: number;
  /** A number applies to all four sides. Default 36 pt. */
  margins?: number | Insets;
  columns?: { count: number; gutter: number };
  bleed?: number | Insets;
  slug?: number | Insets;
}

const asInsets = (v: number | Insets): Insets => (typeof v === 'number' ? uniformInsets(v) : { ...v });

/** A complete, empty page from a partial spec. */
export function makePage(spec: PageSpec = {}): Page {
  return {
    id: spec.id ?? createId('page'),
    width: spec.width ?? 612,
    height: spec.height ?? 792,
    margins: asInsets(spec.margins ?? 36),
    columns: spec.columns ? { ...spec.columns } : { count: 1, gutter: 12 },
    bleed: asInsets(spec.bleed ?? 0),
    slug: asInsets(spec.slug ?? 0),
    items: [],
  };
}

export function makeLayer(spec: Partial<Layer> & { id?: Id } = {}): Layer {
  return {
    id: spec.id ?? createId('layer'),
    name: spec.name ?? 'Layer 1',
    color: spec.color ?? DEFAULT_LAYER_COLOR,
    visible: spec.visible ?? true,
    locked: spec.locked ?? false,
  };
}

export interface CreateDocumentOptions {
  title?: string;
  /** The running Electron version (`process.versions.electron`). The model has no way to know it, so it is required. */
  engineVersion: string;
  colorProfile?: string | null;
  page?: PageSpec;
  layer?: Partial<Layer> & { id?: Id };
}

/**
 * A new document: one empty page, one layer, the built-in swatches ([Paper], [Black], [Registration]), the built-in styles
 * ([Basic Paragraph], [None]) and the default baseline grid.
 */
export function createDocument(options: CreateDocumentOptions): GalleyDocument {
  const page = makePage(options.page);
  const layer = makeLayer(options.layer);
  const swatches = builtinSwatches();
  const paragraphStyles = builtinParagraphStyles();
  const characterStyles = builtinCharacterStyles();
  return {
    formatVersion: FORMAT_VERSION,
    meta: {
      title: options.title ?? 'Untitled',
      engineVersion: options.engineVersion,
      colorProfile: options.colorProfile ?? null,
    },
    pageOrder: [page.id],
    pages: { [page.id]: page },
    layerOrder: [layer.id],
    layers: { [layer.id]: layer },
    swatchOrder: Object.keys(swatches),
    swatches,
    frames: {},
    stories: {},
    paragraphStyleOrder: Object.keys(paragraphStyles),
    paragraphStyles,
    characterStyleOrder: Object.keys(characterStyles),
    characterStyles,
    baselineGrid: { ...DEFAULT_BASELINE_GRID },
    assets: {},
    guides: {},
  };
}
