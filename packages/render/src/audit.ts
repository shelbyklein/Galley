/**
 * Export-mode audit: find every color the DOM paints, so a test (or the export orchestrator, as a last check before
 * printToPDF) can prove that only sentinels are used. Reads SVG paint attributes and inline styles, which is where the
 * renderer puts every color (page.css has none). Works on any DOM, jsdom included.
 */
import { isSentinelCss, type SentinelEntry } from '@galley/model';

export interface PaintedColor {
  /** A short description of the element (`rect[data-frame-id=bg]`). */
  where: string;
  property: string;
  value: string;
}

const PAINT_ATTRIBUTES = ['fill', 'stroke', 'stop-color', 'flood-color', 'lighting-color'];
const COLOR_STYLE_PROPERTIES = [
  'color',
  'background',
  'background-color',
  'background-image',
  'border-color',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'outline-color',
  'box-shadow',
  'text-shadow',
  'text-decoration-color',
  'caret-color',
  'fill',
  'stroke',
];

/** Values that paint nothing. */
const NOTHING = new Set(['', 'none', 'transparent', 'initial', 'inherit', 'unset', 'currentcolor']);

function describe(el: Element): string {
  const id = el.getAttribute('data-frame-id');
  return `${el.tagName.toLowerCase()}${id ? `[data-frame-id=${id}]` : ''}`;
}

/** Every non-trivial color value on `root` and its descendants. */
export function collectPaintedColors(root: Element): PaintedColor[] {
  const out: PaintedColor[] = [];
  const elements = [root, ...Array.from(root.querySelectorAll('*'))];
  for (const el of elements) {
    for (const attr of PAINT_ATTRIBUTES) {
      const value = el.getAttribute(attr);
      if (value !== null && !NOTHING.has(value.trim().toLowerCase())) out.push({ where: describe(el), property: attr, value });
    }
    const style = (el as HTMLElement).style;
    if (style) {
      for (const prop of COLOR_STYLE_PROPERTIES) {
        const value = style.getPropertyValue(prop);
        if (value && !NOTHING.has(value.trim().toLowerCase())) out.push({ where: describe(el), property: prop, value });
      }
    }
  }
  return out;
}

/** The painted colors that are not one of the table's sentinels. Empty means the page is export-clean. */
export function findNonSentinelColors(root: Element, table: readonly SentinelEntry[]): PaintedColor[] {
  return collectPaintedColors(root).filter((c) => !isSentinelCss(table, c.value));
}
