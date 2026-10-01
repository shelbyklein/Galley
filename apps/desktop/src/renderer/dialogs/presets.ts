// Page-size presets of the New Document dialog, in points (portrait). Sizes come from inches or millimeters through the
// model's own conversions, so a preset is the exact physical size; downstream quantization is lane A's rule (P1-04).
import { inches, mm, makePage, pageSchema, uniformInsets, type Insets, type Page } from '@galley/model';

export interface PagePreset {
  id: string;
  label: string;
  /** Portrait width and height in points. */
  width: number;
  height: number;
}

export const PAGE_PRESETS: readonly PagePreset[] = [
  { id: 'letter', label: 'Letter', width: inches(8.5), height: inches(11) },
  { id: 'tabloid', label: 'Tabloid', width: inches(11), height: inches(17) },
  { id: 'a4', label: 'A4', width: mm(210), height: mm(297) },
  { id: 'a3', label: 'A3', width: mm(297), height: mm(420) },
  { id: '18x24', label: '18 × 24 in', width: inches(18), height: inches(24) },
  { id: '24x36', label: '24 × 36 in', width: inches(24), height: inches(36) },
];

export const CUSTOM_PRESET = 'custom';

/** The preset a size matches in either orientation, or undefined. */
export function presetForSize(width: number, height: number): PagePreset | undefined {
  const close = (a: number, b: number) => Math.abs(a - b) < 0.01;
  return PAGE_PRESETS.find((p) => (close(p.width, width) && close(p.height, height)) || (close(p.width, height) && close(p.height, width)));
}

/** Everything the New Document dialog collects, in points. */
export interface NewDocumentSpec {
  width: number;
  height: number;
  margins: Insets;
  columns: { count: number; gutter: number };
  bleed: Insets;
  slug: Insets;
}

export function defaultNewDocumentSpec(): NewDocumentSpec {
  const letter = PAGE_PRESETS[0]!;
  return {
    width: letter.width,
    height: letter.height,
    margins: uniformInsets(36),
    columns: { count: 1, gutter: 12 },
    bleed: uniformInsets(0),
    slug: uniformInsets(0),
  };
}

/** The page the spec makes, or the first problem with it (margins that leave no room, gutters wider than the columns). */
export function pageFromSpec(spec: NewDocumentSpec): { page: Page; error: null } | { page: null; error: string } {
  const page = makePage({ width: spec.width, height: spec.height, margins: spec.margins, columns: spec.columns, bleed: spec.bleed, slug: spec.slug });
  const result = pageSchema.safeParse(page);
  if (result.success) return { page: result.data, error: null };
  const issue = result.error.issues[0]!;
  const where = issue.path.length > 0 ? `${issue.path.join(' ')}: ` : '';
  return { page: null, error: `${where}${issue.message}` };
}
