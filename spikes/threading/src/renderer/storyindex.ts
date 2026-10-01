import type { Node } from 'prosemirror-model';

export interface ParaInfo {
  node: Node;
  pos: number; // position before the paragraph
  cs: number; // content start
  ce: number; // content end
}

/** Paragraph table of a story doc. Story positions used by the engine are always "content positions" (cs..ce). */
export class StoryIndex {
  paras: ParaInfo[] = [];
  constructor(readonly doc: Node) {
    let pos = 0;
    doc.forEach((n) => {
      const cs = pos + 1;
      this.paras.push({ node: n, pos, cs, ce: cs + n.content.size });
      pos += n.nodeSize;
    });
  }
  /** Smallest paragraph index whose content end >= p (a position in a gap between paragraphs resolves to the next one). */
  find(p: number): number {
    const a = this.paras;
    let lo = 0;
    let hi = a.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (a[mid].ce >= p) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  }
  get end(): number {
    return this.paras[this.paras.length - 1].ce;
  }
}

const cache = new WeakMap<Node, StoryIndex>();
export function indexOf(doc: Node): StoryIndex {
  let i = cache.get(doc);
  if (!i) {
    i = new StoryIndex(doc);
    cache.set(doc, i);
  }
  return i;
}
