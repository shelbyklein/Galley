import { BASIC_PARAGRAPH_ID, paragraphAttrs, resolveParagraph, resolveRun, type GalleyDocument, type PMNode, type PMMark, type StyleTables } from '@galley/model';
import { Schema, type Node, type NodeSpec, type MarkSpec } from 'prosemirror-model';
import type { ColorResolver } from '../color';
import { paragraphCss, paragraphLanguage, runCss, toCssText } from '../styles/resolve';
import type { Slot, ParaMetrics } from './slots';
import {layoutParagraph,paragraphViewCss} from './paragraph';

export interface TextContext { tables: StyleTables; colors: ColorResolver; slots: Slot[];grid?:GalleyDocument['baselineGrid'];scale:number }
const contexts = new WeakMap<Schema, TextContext>();
export function setSchemaSlots(schema: Schema, slots: Slot[]) { const c = contexts.get(schema); if (c) c.slots = slots; }
export function textContext(schema:Schema){return contexts.get(schema)!;}
export function resolvedParagraphOf(node:Node) {const ctx=textContext(node.type.schema);return layoutParagraph(ctx.tables,node.toJSON() as PMNode,ctx.grid);}
export function metricsOf(node: Node): ParaMetrics {
  const r = resolvedParagraphOf(node);
  return { font: r.fontSize, leading: r.leading, before: r.spaceBefore, after: r.spaceAfter };
}
/** One schema per story layout. Its DOM serialisation is shared by measurement, editing and export. */
export function createTextSchema(tables: StyleTables | GalleyDocument, colors: ColorResolver, slots: Slot[] = [],scale=1): Schema {
  const ctx: TextContext = { tables, colors, slots,grid:'baselineGrid' in tables?tables.baselineGrid:undefined,scale };
  const nodes: Record<string, NodeSpec> = {
    doc: { content: '(paragraph+ | frame+)' },
    frame: {
      content: 'paragraph*', isolating: true, selectable: false, draggable: false,
      attrs: { slot: { default: 0 } },
      toDOM(node) {
        const s = ctx.slots[node.attrs.slot as number];
        const style = s ? `left:0;top:0;zoom:${ctx.scale};transform-origin:0 0;transform:translate(${s.x/ctx.scale}pt,${s.y/ctx.scale}pt) scale(${1/ctx.scale});width:${s.w}pt;height:${s.h}pt;clip-path:inset(0)` : '';
        return ['div', { class: 'galley-text-slot slot', 'data-slot': String(node.attrs.slot), 'data-frame-id': s?.frame ?? '', style }, 0];
      },
    },
    paragraph: {
      content: 'inline*', group: 'block',
      attrs: { style: { default: BASIC_PARAGRAPH_ID }, overrides: { default: null }, cont: { default: false }, tail: { default: '' },gridPad:{default:0},dropCapWidth:{default:0},dropCapOffsets:{default:null} },
      parseDOM: [{ tag: 'p', getAttrs: dom => ({ style: (dom as HTMLElement).dataset.paragraphStyle || BASIC_PARAGRAPH_ID }) }],
      toDOM(node) {
        const attrs = paragraphAttrs(node.toJSON() as PMNode);
        const r = layoutParagraph(ctx.tables,node.toJSON() as PMNode,ctx.grid);
        const css = paragraphViewCss(r, ctx.colors,node.toJSON() as PMNode);
        const cls = [node.attrs.cont ? 'cont' : '', node.attrs.tail].filter(Boolean).join(' ');
        return ['p', { class: cls, 'data-paragraph-style': attrs.style, 'data-style': attrs.style, lang: paragraphLanguage(r), style: toCssText(css) }, 0];
      },
    },
    text: { group: 'inline' },
  };
  // A mark cannot see its paragraph in toDOM. Canonical combined run styles are applied by runs.ts / editor decorations.
  const markDOM = (type: string, attrs: Record<string, unknown>) => ['span', { [`data-${type}`]: type === 'charStyle' ? String(attrs.style) : '' }, 0] as const;
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
