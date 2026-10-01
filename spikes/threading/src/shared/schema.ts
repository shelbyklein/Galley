// One ProseMirror schema serves two kinds of document:
//   story doc: doc(paragraph+)      the source of truth; paragraphs carry only `style`
//   view doc:  doc(frame+)          derived by the threading engine; frames wrap paragraph *pieces*
// Sharing a schema lets story nodes be reused by identity inside the view doc (cheap diffs, no conversion).
import { Schema, type NodeSpec, type MarkSpec } from 'prosemirror-model';
import { DEFAULT_STYLE } from './styles';
import type { Slot } from './frames';

/** The frame node's toDOM reads geometry from here (frame nodes carry only their slot index). */
export const slotRegistry: { slots: Slot[] } = { slots: [] };

const nodes: Record<string, NodeSpec> = {
  doc: { content: '(paragraph+ | frame+)' },
  frame: {
    content: 'paragraph*',
    isolating: true,
    selectable: false,
    draggable: false,
    attrs: { slot: { default: 0 } },
    toDOM(node) {
      const s = slotRegistry.slots[node.attrs.slot as number];
      const style = s ? `left:${s.x}pt;top:${s.y}pt;width:${s.w}pt;height:${s.h}pt` : '';
      return ['div', { class: 'slot', 'data-slot': String(node.attrs.slot), style }, 0];
    },
  },
  paragraph: {
    content: 'inline*',
    group: 'block',
    attrs: {
      style: { default: DEFAULT_STYLE },
      // view-only attrs, always default in the story doc:
      cont: { default: false }, // piece starts mid-paragraph (continuation): no indent, no space before
      tail: { default: '' }, // '' | 'cn' (continues in the next slot) | 'hy' (continues, and ends mid-word: draw a hyphen)
    },
    parseDOM: [
      { tag: 'p', getAttrs: (dom) => ({ style: (dom as HTMLElement).dataset.style || DEFAULT_STYLE }) },
      { tag: 'h1', attrs: { style: 'heading' } },
      { tag: 'h2', attrs: { style: 'subhead' } },
    ],
    toDOM(node) {
      const a = node.attrs;
      const cls = ['p-' + a.style, a.cont ? 'cont' : '', a.tail === 'cn' ? 'cn' : '', a.tail === 'hy' ? 'hy' : ''].filter(Boolean).join(' ');
      return ['p', { class: cls, 'data-style': a.style }, 0];
    },
  },
  text: { group: 'inline' },
};

const marks: Record<string, MarkSpec> = {
  strong: {
    parseDOM: [{ tag: 'strong' }, { tag: 'b' }, { style: 'font-weight', getAttrs: (v) => /^(bold(er)?|[5-9]\d{2,})$/.test(v as string) && null }],
    toDOM: () => ['strong', 0],
  },
  em: {
    parseDOM: [{ tag: 'i' }, { tag: 'em' }, { style: 'font-style=italic' }],
    toDOM: () => ['em', 0],
  },
};

export const schema = new Schema({ nodes, marks });
