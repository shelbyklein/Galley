import '../../packages/render/src/text/text.css';
// Renderer entry: builds the page, owns the editor, exposes window.galley for tests, wires the demo UI.
import { DOMSerializer, type Node } from 'prosemirror-model';
import type { Command } from 'prosemirror-state';
import { buildCss, PT, styleOf } from './fixture/styles';
import { expandSlots, getPage, type FrameDef, type Obstacle, type PageDef, type Slot } from './fixture/frames';
import { schema } from './fixture/schema';
import { BASE_COPY, buildLongCopy, buildStory, countWords, mulberry32 } from './fixture/story';
import { Measurer } from '../../packages/render/src/text/measure';
import { StoryEditor } from '../../packages/render/src/text/editor';
import { Overlay } from './overlay';
import { extractLines, type DomLine } from '../../packages/render/src/text/lines';
import { indexOf } from '../../packages/render/src/text/storyindex';
import { unthread } from '../../packages/render/src/text/viewdoc';
import { undo, redo, undoDepth, redoDepth } from 'prosemirror-history';
import { toggleMark } from 'prosemirror-commands';

export interface LoadOpts {
  page?: string; // 'default' | 'three' | 'long20'
  story?: 'base' | 'long' | 'empty';
  words?: number; // for story: 'long'
  hyphens?: boolean;
  slotsOverride?: Slot[]; // tests: custom geometry
  frames?: FrameDef[];
  obstacles?: Obstacle[];
  pageSize?: { w: number; h: number };
  copy?: string[]; // explicit copy
}

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

class App {
  editor!: StoryEditor;
  measurer = new Measurer(schema);
  overlay!: Overlay;
  page!: PageDef;
  slots: Slot[] = [];
  obstacles: Obstacle[] = [];
  copy: string[] = BASE_COPY;

  async load(o: LoadOpts = {}) {
    if (this.editor) this.editor.destroy();
    const old = $('#pm');
    const pm = document.createElement('div');
    pm.id = 'pm';
    old.replaceWith(pm);

    const pg = o.frames ? { id: 'custom', w: o.pageSize?.w ?? 612, h: o.pageSize?.h ?? 792, frames: o.frames } : getPage(o.page ?? 'default');
    this.page = pg;
    const pageEl = $('#page');
    pageEl.style.width = pg.w + 'pt';
    pageEl.style.height = pg.h + 'pt';
    document.body.classList.toggle('nohyph', o.hyphens === false);
    const obstacles = pg.obstacles ?? o.obstacles ?? [];
    this.obstacles = obstacles;
    pageEl.querySelectorAll('.image-frame').forEach((e) => e.remove());
    for (const ob of obstacles) {
      const img = document.createElement('div');
      img.className = 'image-frame' + (ob.shape === 'ellipse' ? ' ellipse' : '');
      img.dataset.id = ob.id;
      img.style.cssText = `left:${ob.x}pt;top:${ob.y}pt;width:${ob.w}pt;height:${ob.h}pt`;
      pageEl.insertBefore(img, pageEl.firstChild);
    }
    this.slots = expandSlots(pg.frames, obstacles);
    this.copy = o.copy ?? (o.story === 'long' ? buildLongCopy(o.words ?? 10000) : o.story === 'empty' ? ['B|'] : BASE_COPY);
    const doc = buildStory(this.copy);
    this.editor = new StoryEditor(pm, doc, this.slots, this.measurer);
    this.overlay = new Overlay(pageEl, pg.frames, this.slots);
    this.editor.onUpdate = () => this.refresh();
    this.refresh();
    return this.summary();
  }

  /** Swap the default page for the same page with an image straddling frames 2 and 3 (and back), keeping the story. */
  async toggleWrap() {
    const doc = this.editor.story.doc;
    const hyph = !document.body.classList.contains('nohyph');
    await this.load({ page: this.page.id === 'wrap' ? 'default' : 'wrap', hyphens: hyph });
    this.editor.setStory(doc);
  }

  setHyphens(on: boolean) {
    document.body.classList.toggle('nohyph', !on);
    this.editor.rethreadAll();
  }

  refresh() {
    this.overlay.update(this.editor.res);
    renderReadout(this);
  }

  summary() {
    const e = this.editor;
    return { slots: e.res.slots.length, words: countWords(e.story.doc.textBetween(0, e.story.doc.content.size, ' ')), overset: e.res.overset?.words ?? 0 };
  }
}

// ------------------------------------------------------------------ readout + toolbar (demo)

function pct(a: number[], p: number) {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

function renderReadout(app: App) {
  const el = document.getElementById('readout');
  if (!el) return;
  const e = app.editor;
  const s = e.stats;
  const words = countWords(e.story.doc.textBetween(0, e.story.doc.content.size, ' '));
  const edits = e.statsLog.filter((x) => x.kind === 'view' || x.kind === 'story').slice(-60);
  const med = pct(edits.map((x) => x.total), 50);
  const p95 = pct(edits.map((x) => x.total), 95);
  const over = e.res.overset;
  el.innerHTML =
    `<span class="k">re-thread</span> <b class="${s.total > 16 ? 'bad' : 'ok'}">${s.total.toFixed(2)} ms</b>` +
    ` <span class="dim">(measure ${s.thread.toFixed(2)} · build ${s.build.toFixed(2)} · DOM ${s.view.toFixed(2)} · layout ${s.layout.toFixed(2)})</span>` +
    ` <span class="sep"></span><span class="k">measured</span> ${s.measured}/${s.slots} slots${s.converged ? ' <span class="dim">(converged early)</span>' : ''}` +
    ` <span class="sep"></span><span class="k">last 60 keys</span> median ${med.toFixed(2)} · p95 ${p95.toFixed(2)} ms` +
    ` <span class="sep"></span><span class="k">overset</span> <b class="${over ? 'bad' : 'ok'}">${over ? over.words + ' words' : 'none'}</b>` +
    ` <span class="sep"></span><span class="k">story</span> ${words} words`;
}

function setStyleCmd(style: string): Command {
  return (state, dispatch) => {
    const { from, to } = state.selection;
    const tr = state.tr;
    state.doc.nodesBetween(from, to, (n, pos) => {
      if (n.type === schema.nodes.paragraph) tr.setNodeMarkup(pos, undefined, { ...n.attrs, style });
    });
    dispatch?.(tr);
    return true;
  };
}

function wireToolbar(app: App) {
  const on = (id: string, fn: () => void) => document.getElementById(id)?.addEventListener('mousedown', (e) => (e.preventDefault(), fn()));
  const ed = () => app.editor;
  on('b-undo', () => ed().runStory((s, d) => undo(s, d)));
  on('b-redo', () => ed().runStory((s, d) => redo(s, d)));
  on('b-bold', () => ed().runStory(toggleMark(schema.marks.strong)));
  on('b-italic', () => ed().runStory(toggleMark(schema.marks.em)));
  for (const st of ['heading', 'subhead', 'body', 'quote']) on('s-' + st, () => ed().runStory(setStyleCmd(st)));
  on('b-add', () => {
    const e = ed();
    const extra = buildLongCopy(200, Math.floor(Math.random() * 1e6)).filter((l) => l[0] === 'B');
    const doc = buildStory(extra);
    const tr = e.story.tr.insert(e.story.doc.content.size, doc.content);
    e.runStory((_s, d) => (d?.(tr), true));
  });
  on('b-reset', () => app.load({}));
  on('b-hyph', () => {
    const btn = document.getElementById('b-hyph')!;
    const next = btn.dataset.on !== '1';
    btn.dataset.on = next ? '1' : '0';
    btn.textContent = 'Hyphens: ' + (next ? 'on' : 'off');
    app.setHyphens(next);
  });
  on('b-wrap', () => void app.toggleWrap());
  on('b-chrome', () => document.body.classList.toggle('hide-chrome'));
  on('b-pdf', async () => {
    const out = document.getElementById('pdfresult')!;
    out.textContent = 'printing…';
    const host = window.galleyHost;
    if (!host) return void (out.textContent = 'no host bridge');
    const lines = extractLines($('#page'), $('#pm'));
    const r = await host.exportAndCheck(lines as DomLine[][], app.slots);
    out.innerHTML = r.ok
      ? `<b class="ok">PDF matches screen</b> · ${r.lines} lines in ${r.slots} frames, 0 mismatches · ${r.file}`
      : `<b class="bad">PDF differs</b> · ${r.mismatches} mismatches · ${r.detail}`;
  });
}

// ------------------------------------------------------------------ test API

function frameTexts(): string[] {
  return [...$('#pm').children].map((s) =>
    [...s.children]
      .filter((p) => p.tagName === 'P')
      .map((p) => p.textContent)
      .join('\n'),
  );
}

/** Independent fullness check for frames with wrap floats: re-render a copy of the frame with the next text appended. */
function fullnessProbe(k: number, endMid: boolean, cursor: number, slotEl: HTMLElement, slot: Slot, baseLines: number, idx: ReturnType<typeof indexOf>): string | null {
  const tmp = document.createElement('div');
  tmp.className = 'measure';
  const clone = slotEl.cloneNode(true) as HTMLElement;
  clone.removeAttribute('style');
  clone.style.width = slot.w + 'pt';
  clone.dataset.slot = '0';
  clone.querySelectorAll('.hang').forEach((h) => h.replaceWith(...h.childNodes)); // trailing spaces hang only at a real frame end
  const ps = [...clone.children].filter((c) => c.tagName === 'P') as HTMLElement[];
  const last = ps[ps.length - 1];
  last.classList.remove('hy', 'cn');
  const para = idx.paras[idx.find(cursor)];
  if (!para.node.textContent.slice(endMid ? cursor - para.cs : 0).trim()) return null; // nothing but an empty paragraph follows: no words to probe with
  if (endMid) last.appendChild(document.createTextNode(para.node.textContent.slice(cursor - para.cs, cursor - para.cs + 200)));
  else {
    const np = DOMSerializer.fromSchema(schema).serializeNode(para.node) as HTMLElement;
    clone.appendChild(np);
  }
  tmp.appendChild(clone);
  document.body.appendChild(tmp);
  const ln = extractLines(tmp, tmp)[0] ?? [];
  tmp.remove();
  const extra = ln.slice(baseLines);
  if (!extra.length) return `slot ${k}: fullness probe produced no extra line`;
  const fit = extra.find((l) => l.bottom <= slot.h - 0.02);
  return fit ? `slot ${k} is not full (wrapped): the next text still fits, line "${fit.text.slice(0, 30)}" ends at ${fit.bottom.toFixed(2)} <= ${slot.h}` : null;
}

function invariants(app: App): string[] {
  const bad: string[] = [];
  const e = app.editor;
  const doc = e.story.doc;
  const idx = indexOf(doc);
  const res = e.res;
  const slots = app.slots;

  // 1. view doc is exactly the story, re-assembled (nothing lost or duplicated at any join)
  const back = unthread(e.vdoc, res).doc;
  const overFrom = res.overset?.from ?? idx.end;
  let placedStory = doc.textBetween(0, overFrom, '\n');
  // overset starting exactly at a paragraph's first char: textBetween counts that (empty) paragraph's separator
  if (res.overset && overFrom === idx.paras[idx.find(overFrom)].cs && idx.find(overFrom) > 0) placedStory = placedStory.replace(/\n$/, '');
  const placedView = back.textBetween(0, back.content.size, '\n');
  if (placedStory !== placedView) bad.push('placed text differs: story prefix vs un-threaded view doc');
  if (res.overset && countWords(doc.textBetween(overFrom, idx.end, ' ', ' ')) !== res.overset.words) bad.push('overset word count mismatch');

  // 2. slot boundaries are contiguous
  let expected = idx.paras[0].cs;
  let done = false;
  res.slots.forEach((r, k) => {
    if (done || r.empty) {
      if (!r.empty) bad.push(`slot ${k} has content after the story ended`);
      return;
    }
    if (r.start !== expected) bad.push(`slot ${k} starts at ${r.start}, expected ${expected}`);
    const i = idx.find(r.end);
    if (r.end < idx.paras[i].ce) expected = r.end;
    else if (i === idx.paras.length - 1) done = true;
    else expected = idx.paras[i + 1].cs;
  });

  // 3. DOM text of every frame is exactly the story text between its boundaries
  const texts = frameTexts();
  res.slots.forEach((r, k) => {
    const want = r.empty ? '' : doc.textBetween(r.start, r.end, '\n');
    if ((texts[k] ?? '') !== want) bad.push(`slot ${k} DOM text != story[${r.start},${r.end}]`);
  });

  // 4. geometry: nothing overflows, every frame is full (next line would not fit), leading is regular, continuation styling
  const lines = extractLines($('#page'), $('#pm'));
  const slotEls = [...$('#pm').children] as HTMLElement[];
  const parasOf = (el: Element) => [...el.children].filter((c) => c.tagName === 'P') as HTMLElement[];
  res.slots.forEach((r, k) => {
    const s = slots[k];
    const L = lines[k] ?? [];
    if (r.empty) return;
    const ps = parasOf(slotEls[k]);
    const lastP = ps[ps.length - 1];
    if (!lastP) return void bad.push(`slot ${k} has no paragraphs`);
    const wrapped = s.wraps.length > 0;
    // used height from DOM geometry: bottom of the last paragraph's content (works for empty paragraphs too)
    const slotTop = slotEls[k].getBoundingClientRect().top;
    const used = (lastP.getBoundingClientRect().bottom - parseFloat(getComputedStyle(lastP).paddingBottom) - slotTop) / PT;
    if (used > s.h + 0.02) bad.push(`slot ${k} overflows: ${used.toFixed(2)} > ${s.h}`);
    // would the next line fit?
    let cursor = -1;
    if (k + 1 < res.slots.length && !res.slots[k + 1].empty) cursor = res.slots[k + 1].start;
    else if (res.overset) cursor = res.overset.from;
    if (cursor >= 0 && !wrapped) {
      const lastStyle = styleOf(lastP.getAttribute('data-style') ?? 'body');
      let extra: number;
      if (r.endMid) extra = lastStyle.leading;
      else {
        const nextStyle = styleOf(idx.paras[idx.find(cursor)].node.attrs.style);
        extra = lastStyle.after + nextStyle.before + nextStyle.leading;
      }
      if (used + extra <= s.h - 0.02) bad.push(`slot ${k} is not full: used ${used.toFixed(2)} + next ${extra} <= ${s.h}`);
    } else if (cursor >= 0 && wrapped) {
      // Lines beside a float can be pushed below it, so "used + one leading" is not the next line's position. Instead render
      // the frame again with the next stretch of story appended and look at where the first extra line really lands.
      const msg = fullnessProbe(k, r.endMid, cursor, slotEls[k], s, L.length, idx);
      if (msg) bad.push(msg);
    }
    // regular leading + continuation styling
    ps.forEach((el, pi) => {
      const cs = getComputedStyle(el);
      const st = styleOf(el.dataset.style || 'body');
      if (el.textContent?.trim() && !wrapped) {
        const n = L.filter((l) => l.para === pi).length;
        const ch = el.getBoundingClientRect().height - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
        if (Math.abs(ch - n * st.leading * PT) > 0.05) bad.push(`slot ${k} para ${pi}: content height ${ch} != ${n} lines * leading`);
      }
      if (el.classList.contains('cont') && (cs.textIndent !== '0px' || cs.paddingTop !== '0px')) bad.push(`slot ${k} para ${pi}: continuation has indent/space-before`);
      if (pi === 0 && cs.paddingTop !== '0px') bad.push(`slot ${k}: first paragraph has space-before`);
    });
    // text never enters an obstacle (independent geometric check)
    for (const ob of app.obstacles) {
      const rx = ob.w / 2 + ob.offset;
      const ry = ob.h / 2 + ob.offset;
      const cx = ob.x + ob.w / 2;
      const cy = ob.y + ob.h / 2;
      for (const l of L) {
        const nx = Math.min(Math.max(cx, l.left), l.right) - cx;
        const ny = Math.min(Math.max(cy, l.top), l.bottom) - cy;
        const inside = ob.shape === 'ellipse' ? (nx / rx) ** 2 + (ny / ry) ** 2 < 1 - 0.02 : Math.abs(nx) < rx - 0.5 && Math.abs(ny) < ry - 0.5;
        if (inside) bad.push(`slot ${k}: line "${l.text.slice(0, 24)}" enters obstacle ${ob.id}`);
      }
    }
  });
  return bad;
}

function findPos(app: App, text: string, nth = 0): number {
  const idx = indexOf(app.editor.story.doc);
  let count = 0;
  for (const p of idx.paras) {
    const t = p.node.textContent;
    let from = 0;
    for (;;) {
      const i = t.indexOf(text, from);
      if (i < 0) break;
      if (count++ === nth) return p.cs + i;
      from = i + 1;
    }
  }
  return -1;
}

function install(app: App) {
  const e = () => app.editor;
  const api = {
    app,
    load: (o: LoadOpts) => app.load(o),
    setHyphens: (on: boolean) => app.setHyphens(on),
    summary: () => app.summary(),
    storyParas: () => e().story.doc.content.content.map((n) => n.textContent),
    storyText: () => e().story.doc.textBetween(0, e().story.doc.content.size, '\n'),
    storyJSON: () => e().story.doc.toJSON(),
    storySize: () => e().story.doc.content.size,
    viewJSON: () => e().vdoc.toJSON(),
    slices: () =>
      e().res.slots.map((r, k) => ({
        slot: k,
        ...r,
        text: r.empty ? '' : e().story.doc.textBetween(r.start, r.end, '\n'),
      })),
    overset: () => e().res.overset,
    oversetUi: () => ({ visible: app.overlay.oversetVisible, text: app.overlay.oversetText, portRed: app.overlay.oversetPortRed }),
    frameText: frameTexts,
    lines: () => extractLines($('#page'), $('#pm')),
    invariants: () => invariants(app),
    selection: () => e().storySelection(),
    viewSelection: () => {
      const s = e().view.state.selection;
      return { anchor: s.anchor, head: s.head };
    },
    setSelection: (a: number, h?: number, prefSlot?: number) => e().setStorySelection(a, h ?? a, prefSlot),
    findPos: (t: string, n = 0) => findPos(app, t, n),
    focus: () => e().view.focus(),
    /** viewport coordinates of the caret at a story position (for mouse tests) */
    coordsAt: (pos: number, prefSlot = -1) => {
      const c = e().view.coordsAtPos(e().vmap.storyToView(pos, prefSlot));
      return { x: c.left, top: c.top, bottom: c.bottom };
    },
    caret: () => {
      const s = getSelection();
      if (!s || !s.rangeCount) return null;
      const r = s.getRangeAt(0);
      const rect = r.getClientRects()[0] ?? r.getBoundingClientRect();
      const slot = (r.startContainer.nodeType === 1 ? (r.startContainer as Element) : r.startContainer.parentElement)?.closest('.slot') as HTMLElement | null;
      return { slot: slot ? Number(slot.dataset.slot) : -1, x: rect.left, y: rect.top, collapsed: r.collapsed };
    },
    slotRect: (k: number) => {
      const r = ($('#pm').children[k] as HTMLElement).getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    },
    composing: () => e().composing || e().pendingRethread,
    lastEdit: () => e().lastEdit,
    /** lines of whatever the measurement host currently holds (debugging) */
    measureLines: () => {
      app.measurer.slotEl.dataset.slot = '0';
      return extractLines(app.measurer.host, app.measurer.host)[0] ?? [];
    },
    stats: () => e().stats,
    statsLog: () => e().statsLog,
    clearStats: () => (e().statsLog.length = 0),
    fullThreadMs: () => e().timeFullThread(),
    /** Random story-level edits; after each one the incremental thread must equal a from-scratch thread and all invariants hold. */
    fuzz: (n: number, seed: number) => {
      const rnd = mulberry32(seed);
      const ed = e();
      const words = ['hyphenation', 'extraordinarily', 'the', 'a', 'typography', 'composition', 'of', 'frames', 'internationalization', 'responsibility', 'and', 'I', 'fi', 'throughout', 'x'];
      const rtext = () => {
        const k = 1 + Math.floor(rnd() * 14);
        let t = '';
        // always space-separated: a single word wider than its frame is outside the model (it overflows horizontally and
        // has no consistent line structure), and glued words would create exactly that in a 144pt column
        for (let i = 0; i < k; i++) t += words[Math.floor(rnd() * words.length)] + ' ';
        return t;
      };
      const fails: string[] = [];
      const kinds: Record<string, number> = {};
      for (let i = 0; i < n && !fails.length; i++) {
        const idx = indexOf(ed.story.doc);
        // Most real bugs live exactly at slot boundaries, which uniformly random positions almost never hit:
        // bias ~60% of edits to within 2 characters of a slot start or end.
        const marks = ed.res.slots.filter((s) => !s.empty).flatMap((s) => [s.start, s.end]);
        let p = idx.paras[Math.floor(rnd() * idx.paras.length)];
        let pos = p.cs + Math.floor(rnd() * (p.ce - p.cs + 1));
        if (marks.length && rnd() < 0.6) {
          const m = marks[Math.floor(rnd() * marks.length)];
          p = idx.paras[idx.find(m)];
          pos = Math.max(p.cs, Math.min(p.ce, m + Math.floor(rnd() * 5) - 2));
        }
        // stay inside the model: 21pt bold heading text in a 144pt column makes words wider than the frame (see FINDINGS)
        if (p.node.attrs.style === 'heading') {
          p = idx.paras.find((q) => q.node.attrs.style !== 'heading' && q.cs >= p.cs) ?? idx.paras.find((q) => q.node.attrs.style !== 'heading') ?? p;
          pos = Math.max(p.cs, Math.min(p.ce, pos));
        }
        const op = rnd();
        let kind = '';
        ed.runStory((state, dispatch) => {
          const tr = state.tr;
          if (op < 0.16) {
            // whole-paragraph structure edits: append at the very end, insert between paragraphs, delete a paragraph
            const mk = () => schema.nodes.paragraph.create({ style: ['body', 'body', 'subhead', 'quote'][Math.floor(rnd() * 4)] }, schema.text(rtext() + rtext()));
            const which = rnd();
            // appended/inserted paragraphs of a style that differs from their neighbours cannot "slide" in the diff, so the
            // frontier between slots is genuinely exercised
            const quote = () => schema.nodes.paragraph.create({ style: 'quote' }, schema.text(rtext()));
            if (which < 0.4) (kind = 'append-paragraph'), tr.insert(state.doc.content.size, quote());
            else if (which < 0.75) (kind = 'insert-paragraph'), tr.insert(p.pos, mk());
            else if (idx.paras.length > 4) (kind = 'delete-paragraph'), tr.delete(p.pos, p.pos + p.node.nodeSize);
            else (kind = 'append-paragraph'), tr.insert(state.doc.content.size, mk());
          } else if (op < 0.45) (kind = 'insert'), tr.insertText(rtext(), pos);
          else if (op < 0.7) {
            kind = 'delete';
            const to = Math.min(pos + 1 + Math.floor(rnd() * 80), p.ce);
            if (to > pos) tr.delete(pos, to);
            else tr.insertText('y', pos);
          } else if (op < 0.84) (kind = 'split'), tr.split(pos);
          else if (op < 0.92 && idx.paras.length > 4 && p !== idx.paras[idx.paras.length - 1]) (kind = 'join'), tr.delete(p.ce, p.ce + 2);
          else {
            kind = 'style';
            tr.setNodeMarkup(p.pos, undefined, { ...p.node.attrs, style: ['body', 'body', 'subhead', 'quote'][Math.floor(rnd() * 4)] });
          }
          dispatch?.(tr);
          return true;
        });
        kinds[kind] = (kinds[kind] ?? 0) + 1;
        const bad = [...api.checkIncremental(), ...invariants(app)];
        if (bad.length) fails.push(`step ${i} (${kind} at ${pos}): ${bad.slice(0, 4).join(' | ')}`);
      }
      return { steps: n, kinds, fails, words: countWords(ed.story.doc.textBetween(0, ed.story.doc.content.size, ' ')) };
    },
    /** incremental result == from-scratch result? returns a list of differences */
    checkIncremental: () => {
      const full = e().fullThreadResult();
      const cur = e().res;
      const bad: string[] = [];
      full.slots.forEach((f, k) => {
        const c = cur.slots[k];
        for (const key of ['start', 'end', 'empty', 'startMid', 'endMid', 'hy', 'startStyle'] as const) if (f[key] !== c[key]) bad.push(`slot ${k}.${key}: full ${f[key]} vs incremental ${c[key]}`);
      });
      if ((full.overset?.from ?? null) !== (cur.overset?.from ?? null) || (full.overset?.words ?? 0) !== (cur.overset?.words ?? 0)) bad.push(`overset: full ${JSON.stringify(full.overset)} vs incremental ${JSON.stringify(cur.overset)}`);
      return bad;
    },
    measurerStats: () => ({ ...app.measurer.stats }),
    docEq: () => unthread(e().vdoc, e().res).doc.eq(indexOf(e().story.doc).doc) || (e().res.overset != null),
    historyDepth: () => ({ undo: undoDepth(e().story), redo: redoDepth(e().story) }),
    undo: () => e().runStory((s, d) => undo(s, d)),
    redo: () => e().runStory((s, d) => redo(s, d)),
    setStoryText: (copy: string[]) => e().setStory(buildStory(copy)),
    insertAt: (pos: number, text: string) => {
      const ed = e();
      ed.runStory((s, d) => (d?.(s.tr.insertText(text, pos)), true));
    },
    setCaretToEnd: () => {
      const ed = e();
      const last = ed.vmap.pieces[ed.vmap.pieces.length - 1];
      ed.setStorySelection(last.sTo);
    },
    selectionText: () => {
      const s = e().storySelection();
      return e().story.doc.textBetween(Math.min(s.anchor, s.head), Math.max(s.anchor, s.head), '\n');
    },
    marksAt: (from: number, to: number) => {
      const out: { text: string; marks: string[] }[] = [];
      e().story.doc.nodesBetween(from, to, (n, pos) => {
        if (n.isText) out.push({ text: n.text!.slice(Math.max(0, from - pos), Math.min(n.text!.length, to - pos)), marks: n.marks.map((m) => m.type.name) });
      });
      return out;
    },
  };
  (window as unknown as { galley: typeof api }).galley = api;
}

// ------------------------------------------------------------------ boot

declare global {
  interface Window {
    galleyHost?: { exportAndCheck(lines: DomLine[][], slots: Slot[]): Promise<{ ok: boolean; lines: number; slots: number; mismatches: number; detail: string; file: string }> };
  }
}

async function boot() {
  const style = document.createElement('style');
  style.id = 'galley-css';
  style.textContent = buildCss();
  document.head.appendChild(style);
  await Promise.all(['400 10pt Inter', 'italic 400 10pt Inter', '700 10pt Inter', 'italic 700 10pt Inter'].map((f) => document.fonts.load(f, 'Hamburgefonstiv fi')));
  await document.fonts.ready;
  const q = new URLSearchParams(location.search);
  const app = new App();
  install(app);
  wireToolbar(app);
  await app.load({ page: q.get('page') ?? 'default', story: (q.get('story') as 'base' | 'long') ?? 'base' });
  (window as unknown as { galleyReady: boolean }).galleyReady = true;
  document.documentElement.dataset.ready = '1';
  if (q.get('mode') === 'demo') app.editor.view.focus();
}

void boot();
