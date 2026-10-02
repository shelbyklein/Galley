import { BASIC_PARAGRAPH_ID, paragraphAttrs, resolveParagraph, resolveRun, type GalleyDocument, type PMNode, type PMMark, type StyleTables } from '@galley/model';
import { Schema, type Node, type NodeSpec, type MarkSpec } from 'prosemirror-model';
import type { ColorResolver } from '../color';
import { paragraphCss, paragraphLanguage, runCss, toCssText } from '../styles/resolve';
import type { Slot, ParaMetrics } from './slots';

export interface TextContext { tables: StyleTables; colors: ColorResolver; slots: Slot[] }
const contexts = new WeakMap<Schema, TextContext>();
export function setSchemaSlots(schema: Schema, slots: Slot[]) { const c = contexts.get(schema); if (c) c.slots = slots; }
export function metricsOf(node: Node): ParaMetrics {
  const ctx = contexts.get(node.type.schema)!;
  const r = resolveParagraph(ctx.tables, paragraphAttrs(node.toJSON() as PMNode));
  return { font: r.fontSize, leading: r.leading, before: r.spaceBefore, after: r.spaceAfter };
}
/** One schema per story layout. Its DOM serialisation is shared by measurement, editing and export. */
export function createTextSchema(tables: StyleTables | GalleyDocument, colors: ColorResolver, slots: Slot[] = []): Schema {
  const ctx: TextContext = { tables, colors, slots };
  const nodes: Record<string, NodeSpec> = {
    doc: { content: '(paragraph+ | frame+)' },
    frame: {
      content: 'paragraph*', isolating: true, selectable: false, draggable: false,
      attrs: { slot: { default: 0 } },
      toDOM(node) {
        const s = ctx.slots[node.attrs.slot as number];
        const style = s ? `left:0;top:0;transform:translate(${s.x}pt,${s.y}pt);width:${s.w}pt;height:${s.h}pt;clip-path:inset(0)` : '';
        return ['div', { class: 'galley-text-slot slot', 'data-slot': String(node.attrs.slot), 'data-frame-id': s?.frame ?? '', style }, 0];
      },
    },
    paragraph: {
      content: 'inline*', group: 'block',
      attrs: { style: { default: BASIC_PARAGRAPH_ID }, overrides: { default: null }, cont: { default: false }, tail: { default: '' } },
      parseDOM: [{ tag: 'p', getAttrs: dom => ({ style: (dom as HTMLElement).dataset.paragraphStyle || BASIC_PARAGRAPH_ID }) }],
      toDOM(node) {
        const attrs = paragraphAttrs(node.toJSON() as PMNode);
        const r = resolveParagraph(ctx.tables, attrs);
        const css = paragraphCss(r, ctx.colors);
        if (node.attrs.cont) { css.textIndent = '0'; css.paddingTop = '0'; }
        if (node.attrs.tail && r.align === 'justify') css.textAlignLast = 'justify';
        const cls = [node.attrs.cont ? 'cont' : '', node.attrs.tail].filter(Boolean).join(' ');
        return ['p', { class: cls, 'data-paragraph-style': attrs.style, 'data-style': attrs.style, lang: paragraphLanguage(r), style: toCssText(css) }, 0];
      },
    },
    text: { group: 'inline' },
  };
  const markDOM = (type: string, attrs: Record<string, unknown>) => {
    // Unspecified properties inherit from the paragraph. Distinct sentinels make even explicit default values emit.
    const base = { ...resolveParagraph(ctx.tables, { style: BASIC_PARAGRAPH_ID }), fontFamily: '__inherit__', fontSize: -1, leading: -1, fontWeight: -1, tracking: -1 };
    const r = resolveRun(ctx.tables, base, [{ type, attrs } as PMMark]);
    return ['span', { style: toCssText(runCss(base, r, ctx.colors)), [`data-${type}`]: type === 'charStyle' ? String(attrs.style) : '' }, 0] as const;
  };
  const marks: Record<string, MarkSpec> = {
    charStyle: { attrs: { style: {} }, toDOM: mark => markDOM('charStyle', mark.attrs) },
    override: { attrs: { shared: { default: null }, print: { default: null }, web: { default: null } }, toDOM: mark => markDOM('override', Object.fromEntries(Object.entries(mark.attrs).filter(([,v]) => v != null))) },
    // Native rich text may enter through these temporary marks. The app normalizes them into v2 overrides before storage.
    strong: { parseDOM: [{ tag: 'strong' }, { tag: 'b' }], toDOM: () => ['strong', 0] },
    em: { parseDOM: [{ tag: 'em' }, { tag: 'i' }], toDOM: () => ['em', 0] },
  };
  const schema = new Schema({ nodes, marks });
  contexts.set(schema, ctx);
  return schema;
}
