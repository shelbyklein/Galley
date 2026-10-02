// Ported from the Phase 0 threading spike; see spikes/threading/FINDINGS.md.
// Editing architecture ("derived view doc"):
//
//   story EditorState  (source of truth: doc(paragraph+), selection, undo history)
//        |  threadStory()  measure -> slot boundaries
//        v
//   view doc: doc(frame(paragraph piece...)...)   ONE EditorView, ONE contenteditable root; frames are
//   absolutely positioned child divs, so the browser gives us cross-frame selection and caret movement for free.
//
// View-originated edits (typing, IME, native char deletion, ...) arrive as transactions on the view doc. We un-thread
// the resulting view doc back to a story doc, diff it against the old story doc and apply that diff as one story
// transaction (so undo history is on the story), then re-thread and push the new view doc into the view.
// Edits that are not well defined on the view doc (Enter, Backspace/Delete at a piece boundary, non-collapsed
// selections spanning frames, paste, cut, undo/redo, marks over ranges) are run as ProseMirror commands directly on the
// story state, and the view is regenerated from it.
import { EditorState, TextSelection, type Command, type Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet, EditorView } from 'prosemirror-view';
import { DOMSerializer,Fragment, Slice, type Node } from 'prosemirror-model';
import { history, undo, redo } from 'prosemirror-history';
import { keydownHandler } from 'prosemirror-keymap';
import { chainCommands, deleteSelection, joinBackward, joinForward, splitBlock, toggleMark } from 'prosemirror-commands';
import { resolvedParagraphOf,setSchemaSlots } from './schema';
import {dropCapCss} from '../styles/dropcaps';
import { makeWrapEl } from './wrap';
import {textRunStyle} from './runs';
import {toCssText} from '../styles/resolve';
import type { Slot } from './slots';
import { Measurer } from './measure';
import { indexOf, type StoryIndex } from './storyindex';
import { threadStory, type ThreadResult } from './thread';
import { buildViewDoc, diffRegion, unthread, ViewMap } from './viewdoc';

export interface EditorStats {
  seq: number;
  kind: 'view' | 'story' | 'full' | 'selection';
  thread: number; // ms: threadStory (measurement)
  build: number; // ms: build view doc
  view: number; // ms: EditorView.updateState (DOM patch)
  layout: number; // ms: forced style+layout after the DOM patch
  total: number; // ms: whole commit (view tr -> laid-out DOM)
  latency: number; // ms: keydown -> end of commit (includes the browser's native insertion and PM's DOM read); 0 if not key-driven
  measured: number; // slots measured this commit
  slots: number;
  reused: number; // frame nodes reused from the previous view doc
  converged: boolean;
  oversetWords: number;
}

const surrogate = (s: string) => /[\ud800-\udbff][\udc00-\udfff]$/.test(s);

export class StoryEditor {
  story: EditorState;
  get schema() { return this.story.doc.type.schema; }
  view!: EditorView;
  res!: ThreadResult;
  idx!: StoryIndex;
  vdoc!: Node;
  vmap!: ViewMap;
  stats: EditorStats = { seq: 0, kind: 'full', thread: 0, build: 0, view: 0, layout: 0, total: 0, latency: 0, measured: 0, slots: 0, reused: 0, converged: false, oversetWords: 0 };
  statsLog: EditorStats[] = [];
  private keyT = -1e9;
  private goalX: number | null = null;
  private onKey = (e: KeyboardEvent) => {
    this.keyT = performance.now();
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') this.goalX = null;
  };
  private onMouse = () => (this.goalX = null);
  composing = false;
  /** story changed during an IME composition; the thread/view are stale until the composition ends */
  pendingRethread = false;
  lastEdit: { from: number; oldTo: number; newTo: number } | null = null;
  onUpdate: (() => void) | null = null;

  constructor(
    readonly mount: HTMLElement,
    storyDoc: Node,
    readonly slots: Slot[],
    readonly measurer: Measurer,
    readonly options: {undo?:()=>void;redo?:()=>void;attributes?:Record<string,string>} = {},
  ) {
    setSchemaSlots(storyDoc.type.schema, slots);
    document.addEventListener('keydown', this.onKey, true);
    document.addEventListener('mousedown', this.onMouse, true);
    this.story = EditorState.create({ doc: storyDoc, plugins: [history()] });
    this.idx = indexOf(storyDoc);
    const t0 = performance.now();
    this.res = threadStory({ doc: storyDoc, idx: this.idx, slots, measurer });
    const t1 = performance.now();
    const b = buildViewDoc({ doc: storyDoc, idx: this.idx, res: this.res, slots });
    this.vdoc = b.doc;
    this.vmap = b.map;
    const state = EditorState.create({ doc: this.vdoc, selection: TextSelection.atStart(this.vdoc) });
    this.view = new EditorView({ mount }, {
      state,
      dispatchTransaction: (tr) => this.onViewTr(tr),
      attributes: { ...options.attributes, spellcheck: 'false', autocorrect: 'off', autocapitalize: 'off', lang: 'en-US' },
      decorations: (st) => this.hangDecorations(st.doc),
      nodeViews:{paragraph:(node)=>{
        let current=node;
        const rendered=DOMSerializer.renderSpec(document,node.type.spec.toDOM!(node));
        return {dom:rendered.dom,contentDOM:rendered.contentDOM,update:(next:Node)=>{
          // Native initial-letter needs fresh paragraph DOM when its style changes (Chromium issue reproduced by lane S).
          if(next.type!==current.type || JSON.stringify(next.attrs)!==JSON.stringify(current.attrs)) return false;
          current=next;return true;
        }};
      }},
      handleKeyDown: keydownHandler(this.bindings()),
      handlePaste: (_v, e) => this.paste(e),
      handleDrop: () => true,
      handleDOMEvents: {
        beforeinput: (_v, e) => this.beforeInput(e as InputEvent),
        cut: (_v, e) => this.cut(e as ClipboardEvent),
        compositionstart: () => ((this.composing = true), false),
        compositionend: () => {
          this.composing = false;
          // PM finalises the composition asynchronously (microtask flush + 20ms); re-thread once it has settled
          setTimeout(() => {
            if (this.pendingRethread && !this.composing) this.rethreadAll();
          }, 40);
          return false;
        },
        dragstart: (_v, e) => (e.preventDefault(), true),
      },
    });
    this.record({ kind: 'full', thread: t1 - t0, build: performance.now() - t1, view: 0, layout: 0, total: performance.now() - t0, measured: this.res.measured, reused: 0 });
    this.afterUpdate();
  }

  destroy() {
    document.removeEventListener('keydown', this.onKey, true);
    document.removeEventListener('mousedown', this.onMouse, true);
    this.view.destroy();
  }

  /**
   * The last line of a justified paragraph that continues in the next frame is a "middle" line of the story paragraph,
   * so it is justified (text-align-last: justify). But Chromium then counts the trailing space *inside* the line, so
   * the last word ends one space-width short of the edge. A middle line would have hung that space outside the box.
   * Reproduce that: give the trailing spaces of every continued piece zero advance (word-spacing: -100%).
   * Also places the invisible wrap floats (widgets) at the start of each frame.
   */
  private hangDecorations(doc: Node): DecorationSet {
    const decos: Decoration[] = [];
    doc.forEach((frame, off, k) => {
      // the wrap floats sit at the start of the frame's content, before the first paragraph
      this.slots[k]?.wraps.forEach((w, i) => decos.push(Decoration.widget(off + 1, () => makeWrapEl(w), { side: -1, key: `wrap-${k}-${i}-${w.side}-${w.top}-${w.width}-${w.height}-${w.shape}`, ignoreSelection: true, stopEvent: () => true })));
      frame.forEach((paragraph,pOff)=>{
        const r=resolvedParagraphOf(paragraph),begin=off+pOff+2;
        const cap=r.dropCapLines>0 && r.dropCapChars>1?Array.from(paragraph.textContent).slice(0,r.dropCapChars).join('').length:0;
        let capFragment=0;
        paragraph.forEach((text,tOff)=>{
          const run=textRunStyle(paragraph,text),start=begin+tOff;
          const put=(from:number,to:number,initial:boolean)=>{
            if(from>=to)return;
            let css={...run.css};if(initial){
              delete css.fontSize;delete css.lineHeight;delete css.verticalAlign;delete css.position;delete css.top;
              css={...dropCapCss(r),...css};
              // PM preserves mark boundaries. Reserve one measured exclusion box;
              // paint later fragments inside it without adding another float advance.
              const width=Number(paragraph.attrs.dropCapWidth);
              if(width>0){
                if(capFragment===0)css.width=`${width}pt`;
                else {
                  const offset=paragraph.attrs.dropCapOffsets?.[capFragment]??0;
                  css.width='0pt';css.marginRight='0pt';
                  css.marginLeft=`${offset-width-(r.fontSize+(r.dropCapLines-1)*r.leading)*.15}pt`;
                }
              }
              capFragment++;
            }
            const style=toCssText(css);if(style||run.language)decos.push(Decoration.inline(from,to,{...(style?{style}:{}),...(run.language?{lang:run.language}:{}),...(initial?{'data-drop-cap':String(r.dropCapChars)}:{})}));
          };
          if(tOff<cap){const end=Math.min(begin+cap,start+text.nodeSize);put(start,end,true);put(end,start+text.nodeSize,false);}else put(start,start+text.nodeSize,false);
        });
      });
      const p = frame.lastChild;
      if (!p || !p.attrs.tail) return;
      const t = p.textContent;
      const n = t.length - t.replace(/ +$/, '').length;
      if (!n) return;
      const end = off + 1 + frame.content.size - 1; // inside the last paragraph, at its content end
      decos.push(Decoration.inline(end - n, end, { class: 'hang' }));
    });
    return DecorationSet.create(doc, decos);
  }

  // ---------------------------------------------------------------- pipeline

  private record(p: Partial<EditorStats> & { kind: EditorStats['kind'] }) {
    const now = performance.now();
    this.stats = {
      ...this.stats,
      ...p,
      latency: now - this.keyT < 1000 ? now - this.keyT : 0,
      seq: this.stats.seq + 1,
      slots: this.slots.length,
      converged: this.res.converged,
      oversetWords: this.res.overset?.words ?? 0,
    };
    this.statsLog.push(this.stats);
    if (this.statsLog.length > 20000) this.statsLog.splice(0, 10000);
  }

  private afterUpdate() {
    this.onUpdate?.();
  }

  private headSlot(): number {
    const sel = this.view.state.selection;
    if (!this.vmap.pieces.length) return -1;
    return this.vmap.pieces[this.vmap.pieceAtView(sel.head)].slot;
  }

  /** Replace the story state and regenerate the view. `edit` is derived by diffing old/new story docs. */
  private commit(
    newStory: EditorState,
    o: { prefSlot: number; kind: EditorStats['kind']; full?: boolean; t0?: number; defer?: { state: EditorState; map: ViewMap } },
  ) {
    const t0 = o.t0 ?? performance.now();
    if (o.defer) {
      // IME composition in progress: re-threading now would replace the DOM under the composition and kill the IME
      // session. Accept PM's own view state (the DOM already is that), keep the story in sync, re-thread afterwards.
      this.story = newStory;
      this.vdoc = o.defer.state.doc;
      this.vmap = o.defer.map;
      this.pendingRethread = true;
      this.view.updateState(o.defer.state);
      this.record({ kind: 'view', thread: 0, build: 0, view: performance.now() - t0, layout: 0, total: performance.now() - t0, measured: 0, reused: 0 });
      this.afterUpdate();
      return;
    }
    if (this.pendingRethread) {
      o = { ...o, full: true };
      this.pendingRethread = false;
    }
    const oldDoc = this.story.doc;
    const edit = o.full ? null : diffRegion(oldDoc, newStory.doc, newStory.selection.head);
    this.lastEdit = edit;
    this.story = newStory;
    const doc = newStory.doc;
    if (!edit && !o.full) {
      // selection-only change on the story: just move the view selection
      this.setViewSelection(newStory.selection.anchor, newStory.selection.head, o.prefSlot);
      return;
    }
    const idx = indexOf(doc);
    const t1 = performance.now();
    const res = threadStory({ doc, idx, slots: this.slots, measurer: this.measurer, prev: o.full ? null : this.res, edit });
    const t2 = performance.now();
    const b = buildViewDoc({ doc, idx, res, slots: this.slots, prev: o.full ? null : { view: this.vdoc, res: this.res, edit } });
    const t3 = performance.now();
    this.res = res;
    this.idx = idx;
    this.vdoc = b.doc;
    this.vmap = b.map;
    const sel = newStory.selection;
    const a = b.map.storyToView(sel.anchor, o.prefSlot);
    const h = b.map.storyToView(sel.head, o.prefSlot);
    let vstate = EditorState.create({ doc: b.doc, selection: TextSelection.create(b.doc, a, h) });
    if(newStory.storedMarks) vstate=vstate.apply(vstate.tr.setStoredMarks(newStory.storedMarks));
    this.view.updateState(vstate);
    const t4 = performance.now();
    void document.body.offsetHeight; // force style + layout so the number includes the browser's relayout of the frames
    const t5 = performance.now();
    this.record({ kind: o.kind, thread: t2 - t1, build: t3 - t2, view: t4 - t3, layout: t5 - t4, total: t5 - t0, measured: res.measured, reused: b.reused });
    this.afterUpdate();
  }

  private setViewSelection(a: number, h: number, prefSlot: number) {
    const va = this.vmap.storyToView(a, prefSlot);
    const vh = this.vmap.storyToView(h, prefSlot);
    const doc = this.view.state.doc;
    const cur = this.view.state.selection;
    if (cur.anchor === va && cur.head === vh) return;
    this.view.updateState(this.view.state.apply(this.view.state.tr.setSelection(TextSelection.create(doc, va, vh))));
  }

  /**
   * PM learns about DOM selection changes from an async `selectionchange` event, so view.state.selection can lag the
   * real caret by one task (fast key repeat, scripted input). Any handler that decides from the selection must pull
   * pending DOM changes into PM first.
   */
  private flushDom() {
    (this.view as unknown as { domObserver: { flush(): void } }).domObserver.flush();
  }

  /** The story caret is inside overset text: it exists in the story but has no place on the page. */
  private inOverset(): boolean {
    if (!this.res.overset) return false;
    this.syncStorySelection();
    return this.story.selection.head > (this.vmap.pieces.at(-1)?.sTo ?? 1);
  }

  /** Make the story selection agree with the view selection (before running a story-level command). */
  syncStorySelection() {
    this.flushDom();
    const vs = this.view.state.selection;
    const cur = this.story.selection;
    // The view selection is only a *projection* of the story selection: positions inside overset text have no DOM, so
    // they are clamped to the end of the last frame. If the view still shows exactly that projection the user has not
    // moved it, and the story selection stays authoritative (otherwise typing into overset would scramble the text).
    if (this.vmap.storyToView(cur.anchor, this.headSlot()) === vs.anchor && this.vmap.storyToView(cur.head, this.headSlot()) === vs.head) return;
    const a = this.vmap.viewToStory(vs.anchor);
    const h = this.vmap.viewToStory(vs.head);
    if (cur.anchor !== a || cur.head !== h) {
      this.story = this.story.apply(this.story.tr.setSelection(TextSelection.create(this.story.doc, a, h)));
    }
  }

  private onViewTr(tr: Transaction) {
    if (!tr.docChanged) {
      this.view.updateState(this.view.state.apply(tr));
      if (tr.selectionSet) this.syncStorySelection();
      this.afterUpdate();
      return;
    }
    const t0 = performance.now();
    const ns = this.view.state.apply(tr);
    const { doc: newStoryDoc, map } = unthread(ns.doc, this.res);
    const a = map.viewToStory(ns.selection.anchor);
    const h = map.viewToStory(ns.selection.head);
    const oldDoc = this.story.doc;
    const edit = diffRegion(oldDoc, newStoryDoc, h);
    if (!edit) {
      this.view.updateState(ns);
      return;
    }
    let stTr = this.story.tr.replace(edit.from, edit.oldTo, newStoryDoc.slice(edit.from, edit.newTo));
    if (!stTr.doc.eq(newStoryDoc)) stTr = this.story.tr.replaceWith(0, oldDoc.content.size, newStoryDoc.content);
    stTr.setSelection(TextSelection.create(stTr.doc, a, h));
    if (tr.getMeta('addToHistory') === false) stTr.setMeta('addToHistory', false);
    const slot = ns.doc.resolve(ns.selection.head).depth > 0 ? ns.doc.resolve(ns.selection.head).index(0) : -1;
    const composing = this.composing || !!(this.view as unknown as { composing?: boolean }).composing;
    this.commit(this.story.apply(stTr), { prefSlot: slot, kind: 'view', t0, defer: composing ? { state: ns, map } : undefined });
  }

  // ---------------------------------------------------------------- story-level commands

  runStory(cmd: Command): boolean {
    this.syncStorySelection();
    const slot = this.headSlot();
    const t0 = performance.now();
    cmd(this.story, (tr) => this.commit(this.story.apply(tr), { prefSlot: slot, kind: 'story', t0 }));
    return true; // always swallow the key: native behaviour on a derived DOM is never what we want here
  }

  private bindings(): Record<string, Command> {
    const deleteBefore: Command = (state, dispatch) => {
      const { $from, empty } = state.selection;
      if (!empty || $from.parentOffset === 0) return false;
      const len = surrogate(state.doc.textBetween($from.pos - 2, $from.pos)) ? 2 : 1;
      dispatch?.(state.tr.delete($from.pos - len, $from.pos));
      return true;
    };
    const deleteAfter: Command = (state, dispatch) => {
      const { $from, empty } = state.selection;
      if (!empty || $from.parentOffset >= $from.parent.content.size) return false;
      const len = /^[\ud800-\udbff][\udc00-\udfff]/.test(state.doc.textBetween($from.pos, $from.pos + 2)) ? 2 : 1;
      dispatch?.(state.tr.delete($from.pos, $from.pos + len));
      return true;
    };
    const back = chainCommands(deleteSelection, joinBackward, deleteBefore);
    const fwd = chainCommands(deleteSelection, joinForward, deleteAfter);
    const backspace: Command = () => {
      this.flushDom();
      const s = this.view.state.selection;
      if (s.empty && s.$head.parentOffset > 0 && !this.inOverset()) return false; // plain in-piece deletion: native, mapped back by the diff
      return this.runStory(back);
    };
    const del: Command = () => {
      this.flushDom();
      const s = this.view.state.selection;
      if (s.empty && s.$head.parentOffset < s.$head.parent.content.size && !this.inOverset()) return false;
      return this.runStory(fwd);
    };
    const mark = (name: 'strong' | 'em'): Command => () => {
      this.flushDom();
      const s = this.view.state.selection;
      if (s.empty) return toggleMark(this.schema.marks[name])(this.view.state, this.view.dispatch); // stored mark lives on the view state
      return this.runStory(toggleMark(this.schema.marks[name]));
    };
    const hist = (c: Command): Command => () => {
      const external=c===undo?this.options.undo:this.options.redo;
      if(external) {external();return true;}
      this.syncStorySelection();
      const slot = this.headSlot();
      c(this.story, (tr) => this.commit(this.story.apply(tr), { prefSlot: slot, kind: 'story' }));
      return true;
    };
    return {
      Enter: () => this.runStory(splitBlock),
      'Shift-Enter': () => this.runStory(splitBlock),
      Backspace: backspace,
      'Alt-Backspace': backspace,
      Delete: del,
      'Alt-Delete': del,
      'Mod-z': hist(undo),
      'Mod-y': hist(redo),
      'Shift-Mod-z': hist(redo),
      'Mod-b': mark('strong'),
      'Mod-i': mark('em'),
      ArrowDown: () => this.watchVertical(1, false),
      ArrowUp: () => this.watchVertical(-1, false),
      'Shift-ArrowDown': () => this.watchVertical(1, true),
      'Shift-ArrowUp': () => this.watchVertical(-1, true),
      ArrowRight: () => this.arrow(1, false),
      ArrowLeft: () => this.arrow(-1, false),
      'Shift-ArrowRight': () => this.arrow(1, true),
      'Shift-ArrowLeft': () => this.arrow(-1, true),
    };
  }

  /** Arrow keys at a thread join: the caret positions "end of frame k" and "start of frame k+1" are the same story
   *  position, so skip across them in one keystroke instead of spending a dead keypress. */
  private arrow(dir: 1 | -1, extend: boolean): boolean {
    this.flushDom();
    const sel = this.view.state.selection;
    if (!(sel instanceof TextSelection) || (!extend && !sel.empty) || !this.vmap.pieces.length) return false;
    const i = this.vmap.pieceAtView(sel.head);
    const pc = this.vmap.pieces[i];
    const len = pc.sTo - pc.sFrom;
    let target = -1;
    if (dir > 0 && sel.head === pc.vFrom + len && this.vmap.isJoin(i)) {
      const q = this.vmap.pieces[i + 1];
      target = q.vFrom + Math.min(1, q.sTo - q.sFrom);
    } else if (dir < 0 && sel.head === pc.vFrom && this.vmap.isJoin(i - 1)) {
      const p = this.vmap.pieces[i - 1];
      const pl = p.sTo - p.sFrom;
      target = p.vFrom + pl - Math.min(1, pl);
    }
    if (target < 0) return false;
    const doc = this.view.state.doc;
    this.view.dispatch(this.view.state.tr.setSelection(TextSelection.create(doc, extend ? sel.anchor : target, target)).scrollIntoView());
    return true;
  }

  /**
   * Chromium bug workaround. With `hyphens: auto`, ArrowDown/ArrowUp does nothing when the caret sits at a generated
   * hyphenation break (reproduced in a plain contenteditable, no ProseMirror involved). We let the browser try; if the
   * DOM selection did not move, we make the vertical move ourselves from the caret rect and a remembered goal x,
   * crossing into the neighbouring frame when the current one has no further line.
   */
  private watchVertical(dir: 1 | -1, extend: boolean): boolean {
    const s = getSelection();
    if (!s || !s.rangeCount || !s.focusNode) return false;
    const snap = { node: s.focusNode, off: s.focusOffset };
    const rect = s.getRangeAt(0).getBoundingClientRect();
    if (this.goalX == null) this.goalX = rect.left;
    const goal = this.goalX;
    setTimeout(() => {
      const s2 = getSelection();
      if (!s2 || s2.focusNode !== snap.node || s2.focusOffset !== snap.off) return; // the browser moved: nothing to do
      this.manualVertical(dir, extend, rect, goal);
    }, 0);
    return false;
  }

  private manualVertical(dir: 1 | -1, extend: boolean, rect: DOMRect, goal: number) {
    this.flushDom();
    const dsel = getSelection();
    if (!dsel || !dsel.focusNode) return;
    const sel = this.view.state.selection;
    const slotEls = [...this.view.dom.children] as HTMLElement[];
    const cur = slotEls.findIndex((el) => el.contains(dsel.focusNode));
    const clampX = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      return Math.min(Math.max(goal, r.left + 1), r.right - 1);
    };
    const pick = (pos: number) => {
      const doc = this.view.state.doc;
      this.view.dispatch(this.view.state.tr.setSelection(TextSelection.create(doc, extend ? sel.anchor : pos, pos)).scrollIntoView());
    };

    // 1. A neighbouring line in the same frame. At a hyphenation break the DOM offset is BOTH "end of line N" and "start
    //    of line N+1" and a DOM selection cannot say which (Chromium keeps the former, and cannot move down from it).
    //    If the hit test at the goal column returns that very offset, step one character into the neighbouring line.
    if (cur >= 0) {
      const hit = this.view.posAtCoords({ left: clampX(slotEls[cur]), top: dir > 0 ? rect.bottom + 4 : rect.top - 4 });
      if (hit && slotEls[cur].contains(this.view.domAtPos(hit.pos).node)) {
        const here = sel.head;
        const d = this.view.state.doc;
        let target = -1;
        if (hit.pos === here) {
          target = here + dir; // the break itself: step into the neighbouring line (never leaving the textblock)
          if (target < 0 || target > d.content.size || d.resolve(target).parent !== d.resolve(here).parent) target = -1;
        } else {
          const c = this.view.coordsAtPos(hit.pos);
          if (dir > 0 ? c.top > rect.top + 2 : c.top < rect.top - 2) target = hit.pos; // really on another line
        }
        if (target >= 0) return pick(target);
      }
    }

    // 2. This is the last (first) line of the frame: go to the first (last) line of the next (previous) non-empty frame.
    for (let j = cur + dir; j >= 0 && j < slotEls.length; j += dir) {
      const el = slotEls[j];
      if (!el.children.length) continue;
      const r = el.getBoundingClientRect();
      const h = this.view.posAtCoords({ left: clampX(el), top: dir > 0 ? r.top + 3 : this.lastLineY(el) });
      if (h) return pick(h.pos);
    }
  }

  private lastLineY(el: HTMLElement): number {
    const last = el.lastElementChild as HTMLElement;
    const r = last.getBoundingClientRect();
    const pb = parseFloat(getComputedStyle(last).paddingBottom);
    return r.bottom - pb - 4;
  }

  private beforeInput(e: InputEvent): boolean {
    if (this.composing || e.isComposing || e.inputType === 'insertCompositionText') return false;
    if (e.inputType === 'historyUndo' || e.inputType === 'historyRedo') {
      e.preventDefault();
      const external=e.inputType==='historyUndo'?this.options.undo:this.options.redo;
      if(external) {external();return true;}
      this.syncStorySelection();
      const slot = this.headSlot();
      (e.inputType === 'historyUndo' ? undo : redo)(this.story, (tr) => this.commit(this.story.apply(tr), { prefSlot: slot, kind: 'story' }));
      return true;
    }
    this.flushDom();
    if ((e.inputType === 'insertText' || e.inputType === 'insertReplacementText') && this.inOverset()) {
      e.preventDefault();
      this.runStory((state, dispatch) => (dispatch?.(state.tr.insertText(e.data ?? '')), true));
      return true;
    }
    const sel = this.view.state.selection;
    if (sel.empty || !this.vmap.pieces.length) return false;
    if (this.vmap.pieceAtView(sel.from) === this.vmap.pieceAtView(sel.to)) return false; // inside one piece: native
    e.preventDefault();
    switch (e.inputType) {
      case 'insertText':
      case 'insertReplacementText':
        this.runStory((state, dispatch) => (dispatch?.(state.tr.insertText(e.data ?? '')), true));
        break;
      case 'insertParagraph':
      case 'insertLineBreak':
        this.runStory(splitBlock);
        break;
      case 'insertFromPaste':
      case 'insertFromDrop':
        break; // handled by the paste/drop props
      default:
        if (e.inputType.startsWith('delete')) this.runStory(deleteSelection);
    }
    return true;
  }

  private paste(e: ClipboardEvent): boolean {
    const text = e.clipboardData?.getData('text/plain');
    if (!text) return false;
    const lines = text.replace(/\r\n?/g, '\n').split(/\n+/);
    this.runStory((state, dispatch) => {
      const style = state.selection.$from.parent.attrs.style as string;
      const tr = state.tr;
      if (lines.length === 1) tr.insertText(lines[0]);
      else {
        const frag = Fragment.from(lines.map((t) => this.schema.nodes.paragraph.create({ style }, t ? this.schema.text(t) : null)));
        tr.replaceSelection(new Slice(frag, 1, 1));
      }
      dispatch?.(tr);
      return true;
    });
    return true;
  }

  private cut(e: ClipboardEvent): boolean {
    const s = this.view.state.selection;
    if (s.empty) return false;
    this.syncStorySelection();
    const { from, to } = this.story.selection;
    e.clipboardData?.setData('text/plain', this.story.doc.textBetween(from, to, '\n'));
    e.preventDefault();
    this.runStory(deleteSelection);
    return true;
  }

  // ---------------------------------------------------------------- programmatic API (demo + tests)

  /** Replace the whole story (keeps undo history). */
  setStory(doc: Node) {
    const tr = this.story.tr.replaceWith(0, this.story.doc.content.size, doc.content);
    tr.setSelection(TextSelection.atStart(tr.doc));
    this.commit(this.story.apply(tr), { prefSlot: -1, kind: 'story', full: true });
  }

  /** External model undo/format change; keeps the story source and selection, without making an internal history entry. */
  setExternalStory(doc:Node) {
    if(this.story.doc.eq(doc)) return;
    const old=this.story.selection;
    const tr=this.story.tr.replaceWith(0,this.story.doc.content.size,doc.content).setMeta('addToHistory',false);
    const clamp=(p:number)=>Math.max(1,Math.min(p,tr.doc.content.size-1));
    tr.setSelection(TextSelection.create(tr.doc,clamp(old.anchor),clamp(old.head)));
    this.commit(this.story.apply(tr),{prefSlot:this.headSlot(),kind:'full',full:true});
  }
  setStoredMarks(marks:readonly import('prosemirror-model').Mark[]) {
    this.story=this.story.apply(this.story.tr.setStoredMarks(marks));
    this.view.updateState(this.view.state.apply(this.view.state.tr.setStoredMarks(marks)));
    this.afterUpdate();
  }

  /** Full re-thread of the unchanged story (e.g. after a CSS change such as toggling hyphenation). */
  rethreadAll() {
    this.commit(this.story, { prefSlot: this.headSlot(), kind: 'full', full: true });
  }

  apply(cmd: Command): boolean {
    return this.runStory(cmd);
  }

  setStorySelection(anchor: number, head = anchor, prefSlot?: number) {
    const slot = prefSlot ?? this.headSlot();
    this.story = this.story.apply(this.story.tr.setSelection(TextSelection.create(this.story.doc, anchor, head)));
    this.setViewSelection(anchor, head, slot);
    this.afterUpdate();
  }

  storySelection() {
    this.syncStorySelection();
    const s = this.story.selection;
    return { anchor: s.anchor, head: s.head };
  }

  /** What a from-scratch thread of the current story gives (for checking the incremental result). */
  fullThreadResult(): ThreadResult {
    return threadStory({ doc: this.story.doc, idx: indexOf(this.story.doc), slots: this.slots, measurer: this.measurer });
  }

  /** Dry-run a full (non-incremental) thread of the current story; returns ms. Does not touch any state. */
  timeFullThread(): number {
    const t = performance.now();
    threadStory({ doc: this.story.doc, idx: indexOf(this.story.doc), slots: this.slots, measurer: this.measurer });
    return performance.now() - t;
  }
}
