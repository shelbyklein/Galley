// Ported from the Phase 0 threading spike; see spikes/threading/FINDINGS.md.
// story doc  <->  view doc.
//
//   buildViewDoc: story + ThreadResult -> doc(frame(paragraph piece...)...) plus a position map
//   unthread:     (edited) view doc    -> story doc plus a position map
//
// A "piece" is the part of one story paragraph that sits in one slot. A story paragraph split across slots becomes
// several pieces; unthread() glues the first piece of slot k back onto the last piece of the previous non-empty slot
// when slot k starts mid-paragraph (the thread's join flag).
import { Fragment, type Node } from 'prosemirror-model';
import type { Slot } from './slots';
import type { StoryIndex } from './storyindex';
import type { SlotResult } from './measure';
import type { Edit, ThreadResult } from './thread';

export interface PieceMap {
  slot: number;
  sFrom: number; // story pos of the first char of the piece
  sTo: number; // story pos after the last char
  vFrom: number; // view pos of the first char of the piece
}

export class ViewMap {
  constructor(readonly pieces: PieceMap[]) {}

  /** Index of the piece containing view pos p (vFrom <= p <= vTo), else the nearest following piece (clamped). */
  pieceAtView(p: number): number {
    const a = this.pieces;
    let lo = 0;
    let hi = a.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (a[mid].vFrom <= p) lo = mid;
      else hi = mid - 1;
    }
    // p may lie after the end of piece lo (structure tokens): then it belongs to the next piece's start if any
    if (lo < a.length - 1 && p > a[lo].vFrom + (a[lo].sTo - a[lo].sFrom)) return lo + 1;
    return lo;
  }

  viewToStory(p: number): number {
    if (!this.pieces.length) return 1;
    const i = this.pieceAtView(p);
    const pc = this.pieces[i];
    const len = pc.sTo - pc.sFrom;
    return pc.sFrom + Math.min(Math.max(p - pc.vFrom, 0), len);
  }

  /** Story pos -> view pos. At a thread join the position exists in two slots; `preferSlot` picks one (default: the earlier). */
  storyToView(s: number, preferSlot = -1): number {
    const a = this.pieces;
    if (!a.length) return 1;
    // candidates: pieces with sFrom <= s <= sTo; they are sorted, find the first
    let lo = 0;
    let hi = a.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (a[mid].sTo >= s) hi = mid;
      else lo = mid + 1;
    }
    let i = lo;
    if (a[i].sTo < s) return a[i].vFrom + (a[i].sTo - a[i].sFrom); // past the end (overset): clamp
    if (a[i].sFrom > s) return a[i].vFrom; // in a gap before this piece
    // another candidate right after (join)?
    if (i + 1 < a.length && a[i + 1].sFrom <= s && s <= a[i + 1].sTo && preferSlot === a[i + 1].slot) i++;
    const pc = a[i];
    return pc.vFrom + (s - pc.sFrom);
  }

  /** Are pieces i and i+1 two halves of one story paragraph, split at a slot boundary? */
  isJoin(i: number): boolean {
    const a = this.pieces;
    return i >= 0 && i + 1 < a.length && a[i].slot !== a[i + 1].slot && a[i].sTo === a[i + 1].sFrom;
  }
}

function slotPieces(idx: StoryIndex, r: SlotResult): { para: number; from: number; to: number }[] {
  if (r.empty) return [];
  const i0 = idx.find(r.start);
  const i1 = idx.find(r.end);
  const out: { para: number; from: number; to: number }[] = [];
  for (let i = i0; i <= i1; i++) {
    const p = idx.paras[i];
    out.push({ para: i, from: i === i0 ? r.start : p.cs, to: i === i1 ? r.end : p.ce });
  }
  return out;
}

function sameSlot(a: SlotResult, b: SlotResult, d: number): boolean {
  return a.empty === b.empty && a.startMid === b.startMid && a.endMid === b.endMid && a.hy === b.hy && a.start + d === b.start && a.end + d === b.end && JSON.stringify(a.gridPads)===JSON.stringify(b.gridPads) && JSON.stringify(a.dropCapWidths)===JSON.stringify(b.dropCapWidths) && JSON.stringify(a.dropCapOffsets)===JSON.stringify(b.dropCapOffsets);
}

export function buildViewDoc(args: {
  doc: Node;
  idx: StoryIndex;
  res: ThreadResult;
  slots: Slot[];
  prev?: { view: Node; res: ThreadResult; edit: Edit | null } | null;
}): { doc: Node; map: ViewMap; reused: number } {
  const { idx, res, slots, prev } = args;
  const schema = args.doc.type.schema;
  const frames: Node[] = [];
  const pieces: PieceMap[] = [];
  let vpos = 0; // view position before the current frame
  let reused = 0;
  const edit = prev?.edit ?? null;
  const delta = edit ? edit.newTo - edit.oldTo : 0;

  for (let k = 0; k < slots.length; k++) {
    const r = res.slots[k];
    const pcs = slotPieces(idx, r);
    let frame: Node | null = null;
    if (prev && edit && prev.view.childCount === slots.length) {
      const ps = prev.res.slots[k];
      // untouched slot: entirely before the edit, or entirely after it (shifted), with identical boundaries
      const before = ps.end < edit.from;
      const after = ps.start >= edit.oldTo;
      if ((before && sameSlot(ps, r, 0)) || (after && sameSlot(ps, r, delta))) {
        frame = prev.view.child(k);
        reused++;
      }
    }
    const paraNodes: Node[] = [];
    let p = vpos + 1; // inside the frame
    for (let j = 0; j < pcs.length; j++) {
      const pc = pcs[j];
      const info = idx.paras[pc.para];
      const cont = pc.from > info.cs;
      const endsMid = pc.to < info.ce;
      pieces.push({ slot: k, sFrom: pc.from, sTo: pc.to, vFrom: p + 1 });
      if (!frame) {
        const gridPad=r.gridPads?.[j] ?? 0;
        const dropCapWidth=r.dropCapWidths?.[j] ?? 0,dropCapOffsets=r.dropCapOffsets?.[j] ?? null;
        if (!cont && !endsMid && !gridPad && !dropCapWidth) paraNodes.push(info.node);
        else {
          const tail = endsMid ? (j === pcs.length - 1 && r.hy ? 'hy' : 'cn') : '';
          paraNodes.push(
            schema.nodes.paragraph.create({ ...info.node.attrs, cont, tail,gridPad,dropCapWidth,dropCapOffsets }, info.node.content.cut(pc.from - info.cs, pc.to - info.cs)),
          );
        }
      }
      p += 2 + (pc.to - pc.from);
    }
    if (!frame) frame = schema.nodes.frame.create({ slot: k }, paraNodes);
    frames.push(frame);
    vpos += frame.nodeSize;
  }
  return { doc: schema.nodes.doc.create(null, frames), map: new ViewMap(pieces), reused };
}

/**
 * Rebuild the story doc from a (possibly user-edited) view doc.
 * `res` is the thread result the view doc was built from: its startMid flags say which slot boundaries are joins.
 */
export function unthread(view: Node, res: ThreadResult): { doc: Node; map: ViewMap } {
  const schema = view.type.schema;
  interface Group {
    attrs: Record<string, unknown>;
    parts: { vFrom: number; len: number; content: Fragment; slot: number }[];
    node: Node | null; // set when the group is exactly one untouched story-shaped paragraph
  }
  const groups: Group[] = [];
  let vpos = 0;
  for (let k = 0; k < view.childCount; k++) {
    const frame = view.child(k);
    let p = vpos + 1;
    for (let j = 0; j < frame.childCount; j++) {
      const piece = frame.child(j);
      const part = { vFrom: p + 1, len: piece.content.size, content: piece.content, slot: k };
      const join = j === 0 && groups.length > 0 && res.slots[k]?.startMid && !res.slots[k].empty;
      if (join) {
        groups[groups.length - 1].parts.push(part);
        groups[groups.length - 1].node = null;
      } else {
        const a = piece.attrs;
        groups.push({ attrs: { style: a.style, overrides: a.overrides }, parts: [part], node: !a.cont && !a.tail && !a.gridPad && !a.dropCapWidth ? piece : null });
      }
      p += piece.nodeSize;
    }
    vpos += frame.nodeSize;
  }

  const paras: Node[] = [];
  const pieces: PieceMap[] = [];
  let spos = 0;
  for (const g of groups) {
    let content: Fragment;
    if (g.node) content = g.node.content;
    else {
      content = Fragment.empty;
      for (const part of g.parts) content = content.append(part.content);
    }
    let s = spos + 1;
    for (const part of g.parts) {
      pieces.push({ slot: part.slot, sFrom: s, sTo: s + part.len, vFrom: part.vFrom });
      s += part.len;
    }
    paras.push(g.node ?? schema.nodes.paragraph.create(g.attrs, content));
    spos = s + 1;
  }
  return { doc: schema.nodes.doc.create(null, paras), map: new ViewMap(pieces) };
}

/**
 * Changed region between two story docs (old coordinates [from, oldTo) became new [from, newTo)).
 * A pure insertion or deletion next to identical characters has several equivalent placements ("aa" -> "aaa").
 * `prefer` is the caret in the NEW doc: insertions are placed so they END at the caret, deletions so they START at it,
 * which is what the user did and what undo-history adjacency expects.
 */
export function diffRegion(a: Node, b: Node, prefer?: number): Edit | null {
  const start = a.content.findDiffStart(b.content);
  if (start == null) return null;
  const e = a.content.findDiffEnd(b.content)!;
  const endA = e.a;
  const endB = e.b;
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
  if (endA < start && a.content.size < b.content.size) {
    const len = b.content.size - a.content.size;
    const x = prefer == null ? start : clamp(prefer - len, endA, start);
    return { from: x, oldTo: x, newTo: x + len };
  }
  if (endB < start && a.content.size > b.content.size) {
    const len = a.content.size - b.content.size;
    const x = prefer == null ? start : clamp(prefer, endB, start);
    return { from: x, oldTo: x + len, newTo: x };
  }
  return { from: start, oldTo: endA, newTo: endB };
}
