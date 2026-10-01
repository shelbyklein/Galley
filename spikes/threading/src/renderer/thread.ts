// The threading engine: story + slot chain -> where each slot starts and ends in the story.
// Incremental: given the previous result and the edited region, slots before the edit are reused, slots from the edit
// onward are re-measured, and measuring stops as soon as a slot reproduces its old (shifted) boundaries, because
// everything after it is then identical text at identical widths.
import type { Node } from 'prosemirror-model';
import type { Slot } from '../shared/frames';
import { countWords } from '../shared/story';
import { Measurer, type SlotResult } from './measure';
import type { StoryIndex } from './storyindex';

export interface Edit {
  from: number; // old-doc coordinates: [from, oldTo) was replaced by new-doc [from, newTo)
  oldTo: number;
  newTo: number;
}

export interface Overset {
  from: number; // story pos where the unplaced text begins
  words: number;
}

export interface ThreadResult {
  slots: SlotResult[];
  overset: Overset | null;
  measured: number; // slots actually measured (incremental stats)
  converged: boolean; // incremental run stopped early
}

type Cursor = { done: true } | { done: false; pos: number };

function emptyResult(idx: StoryIndex): SlotResult {
  const e = idx.end;
  return { start: e, end: e, empty: true, startMid: false, endMid: false, hy: false, startStyle: 'body', lines: 0, frontier: e + 2 };
}

function cursorAfter(idx: StoryIndex, r: SlotResult, before: Cursor): Cursor {
  if (r.empty) return before; // nothing fit: the next slot starts at the same place
  const i = idx.find(r.end);
  const p = idx.paras[i];
  if (r.end < p.ce) return { done: false, pos: r.end };
  if (i === idx.paras.length - 1) return { done: true };
  return { done: false, pos: idx.paras[i + 1].cs };
}

export function shiftSlot(s: SlotResult, d: number): SlotResult {
  return d === 0 ? s : { ...s, start: s.start + d, end: s.end + d, frontier: s.frontier + d };
}

function oversetOf(doc: Node, idx: StoryIndex, pos: number): Overset {
  return { from: pos, words: countWords(doc.textBetween(pos, idx.end, ' ', ' ')) };
}

export function threadStory(args: {
  doc: Node;
  idx: StoryIndex;
  slots: Slot[];
  measurer: Measurer;
  prev?: ThreadResult | null;
  edit?: Edit | null;
}): ThreadResult {
  const { doc, idx, slots, measurer } = args;
  const prev = args.prev && args.prev.slots.length === slots.length ? args.prev : null;
  const edit = prev ? args.edit ?? null : null;
  const n = slots.length;
  const res: SlotResult[] = new Array(n);
  const delta = edit ? edit.newTo - edit.oldTo : 0;
  let first = 0;
  let measured = 0;
  let converged = false;
  let cursor: Cursor = { done: false, pos: idx.paras[0].cs };

  if (prev && edit) {
    // First slot that can be affected: the first whose frontier reaches the edit. The frontier is the end of the first word
    // after the slot's cut (or the next paragraph start): an edit there does not touch the slot's text but can change
    // whether that word (or a hyphenated prefix of it) fits on the slot's last line, or lets appended text flow in.
    first = n;
    for (let k = 0; k < n; k++) {
      if (prev.slots[k].frontier >= edit.from) {
        first = k;
        break;
      }
    }
    for (let k = 0; k < first; k++) {
      res[k] = prev.slots[k];
      cursor = cursorAfter(idx, res[k], cursor);
    }
  }

  // Old position -> new position for a slot START. Content at or after oldTo moves by delta (checked first: for a pure
  // insertion from == oldTo, and the old content that began at that position now begins after the inserted text).
  const mapOld = (p: number) => (p >= edit!.oldTo ? p + delta : p <= edit!.from ? p : NaN);
  let k = first;
  for (; k < n; k++) {
    if (cursor.done) {
      res[k] = emptyResult(idx);
      continue;
    }
    if (prev && edit && k > first) {
      const ps = prev.slots[k];
      if (!ps.empty && ps.start >= edit.oldTo && mapOld(ps.start) === cursor.pos) {
        // same start position: compare the things that are not implied by the position alone
        const i = idx.find(cursor.pos);
        const mid = cursor.pos > idx.paras[i].cs;
        if (mid === ps.startMid && idx.paras[i].node.attrs.style === ps.startStyle) {
          for (let j = k; j < n; j++) res[j] = shiftSlot(prev.slots[j], delta);
          converged = true;
          const last = res[n - 1];
          cursor = cursorAfter(idx, last, { done: false, pos: last.start });
          if (prev.overset) {
            // overset text is unchanged and shifted; its word count is unchanged
            return { slots: res, overset: { from: prev.overset.from + delta, words: prev.overset.words }, measured, converged };
          }
          return { slots: res, overset: null, measured, converged };
        }
      }
    }
    const r = measurer.measureSlot(idx, cursor.pos, slots[k]);
    measured++;
    res[k] = r;
    cursor = cursorAfter(idx, r, cursor);
  }

  return { slots: res, overset: cursor.done ? null : oversetOf(doc, idx, cursor.pos), measured, converged };
}
