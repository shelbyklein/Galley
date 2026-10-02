// Ported from the Phase 0 threading spike; see spikes/threading/FINDINGS.md.
// The measurement half of the threading engine.
//
// For one slot: render the *remaining story* (from `startPos`) at the slot's width into a hidden container that uses
// exactly the same CSS and DOM as the real frame, then find the last line whose box fits inside the slot height.
//
// Line detection strategy (see FINDINGS for the reasoning):
//  * Paragraph geometry comes from one getBoundingClientRect() per paragraph (cheap, layout is already clean).
//  * Leading is fixed per style, so line i of a paragraph occupies [contentTop + i*L, contentTop + (i+1)*L).
//    The number of lines that fit in the slot is therefore floor((H - contentTop)/L): no per-line geometry is needed
//    for paragraphs that fit, and only ONE paragraph (the one straddling the slot bottom) needs a character offset.
//  * That offset is found by binary search over single-character Range rects: "which line is character c on?" is
//    monotonic in c, so the last character of line (nFit-1) is found in ~log2(len) probes. A single-character range
//    has exactly one client rect, so there is no ambiguity about trailing spaces, hanging punctuation or inline
//    (bold/italic) element boundaries, and a break INSIDE a word (hyphens:auto) is found like any other.
import { DOMSerializer, type Node } from 'prosemirror-model';
import { metricsOf } from './schema';
import type { Schema } from 'prosemirror-model';
import { PT, type ParaMetrics } from './slots';
import type { Slot } from './slots';
import { makeWrapEl } from './wrap';
import type { StoryIndex, ParaInfo } from './storyindex';

export interface SlotResult {
  start: number; // story pos of the first char in this slot (content position)
  end: number; // story pos just after the last char in this slot
  empty: boolean; // nothing fits / story exhausted: the slot holds no paragraph pieces at all
  startMid: boolean; // slot starts in the middle of a story paragraph
  endMid: boolean; // slot ends in the middle of a story paragraph
  hy: boolean; // ... and the cut falls inside a word, so a hyphen is drawn at the end of the last line
  startStyle: string; // style of the paragraph containing `start`
  lines: number; // lines placed (diagnostic)
  /**
   * How far past `end` an edit can still change this slot's cut. Whether the first word after the cut moves up onto the
   * last line (whole, or as a hyphenated prefix) depends on that whole word, so the frontier is the end of that word; at a
   * paragraph boundary it is the next paragraph's start (end + 2), where appended or inserted paragraphs flow in. If that
   * first word is the paragraph's last word it is also the next paragraph's start (see measureSlot).
   */
  frontier: number;
}

interface Rec {
  el: HTMLElement;
  para: ParaInfo;
  from: number;
  len: number;
  cont: boolean;
  style: ParaMetrics;
}

const EPS = 0.02; // px
const IRREGULAR_TOL = 0.75; // px: tolerance of the centre-based line-bottom estimate on irregular paragraphs
const AVG_CHAR_EM = 0.46; // deliberately low so the first batch over-fills rather than under-fills

export class Measurer {
  readonly host: HTMLElement;
  readonly slotEl: HTMLElement;
  private ser: DOMSerializer;
  private range = document.createRange();
  stats = { slots: 0, paras: 0, probes: 0, buildMs: 0, layoutMs: 0, probeMs: 0 };

  constructor(readonly schema: Schema) {
    this.ser = DOMSerializer.fromSchema(schema);
    this.host = document.createElement('div');
    this.host.className = 'galley-text-measure';
    this.host.style.cssText = 'position:absolute;left:0;top:0;visibility:hidden;pointer-events:none;contain:layout style;z-index:-1';
    this.host.setAttribute('aria-hidden', 'true');
    this.slotEl = document.createElement('div');
    this.slotEl.className = 'galley-text-slot slot';
    this.host.appendChild(this.slotEl);
    document.body.appendChild(this.host);
  }

  dispose() {
    this.host.remove();
  }

  private estimate(node: Node, style: ParaMetrics, widthPx: number): number {
    const chars = node.content.size;
    const perLine = Math.max(1, widthPx / (style.font * PT * AVG_CHAR_EM));
    const lines = Math.max(1, Math.ceil(chars / perLine));
    return lines * style.leading * PT + (style.before + style.after) * PT;
  }

  private build(para: ParaInfo, from: number, first: boolean): Rec {
    const style = metricsOf(para.node);
    const cont = from > para.cs;
    const node = cont
      ? this.schema.nodes.paragraph.create({ ...para.node.attrs, cont: true }, para.node.content.cut(from - para.cs))
      : para.node;
    const t0 = performance.now();
    const el = this.ser.serializeNode(node) as HTMLElement;
    if (node.content.size === 0) el.appendChild(document.createElement('br')); // PM's trailing-break hack, so empty paragraphs have a line
    this.slotEl.appendChild(el);
    this.stats.buildMs += performance.now() - t0;
    this.stats.paras++;
    return { el, para, from, len: para.ce - from, cont, style };
  }

  measureSlot(idx: StoryIndex, startPos: number, slot: Slot): SlotResult {
    this.stats.slots++;
    const slotEl = this.slotEl;
    slotEl.textContent = '';
    slotEl.style.width = slot.w + 'pt';
    for (const w of slot.wraps) slotEl.appendChild(makeWrapEl(w));
    const H = slot.h * PT;
    const widthPx = slot.w * PT;
    const paras = idx.paras;
    const i0 = idx.find(startPos);
    const startPara = paras[i0];
    const startMid = startPos > startPara.cs;
    const base = { start: startPos, startMid, startStyle: startPara.node.attrs.style as string };

    const recs: Rec[] = [];
    let next = i0;
    let analyzed = 0;
    let need = H * 1.15;
    let lines = 0;

    for (;;) {
      // grow the chunk until its *estimated* height covers what is still needed
      let est = 0;
      do {
        if (next >= paras.length) break;
        const p = paras[next];
        const from = next === i0 ? startPos : p.cs;
        const r = this.build(p, from, next === i0);
        recs.push(r);
        est += this.estimate(p.node, r.style, widthPx);
        next++;
      } while (est < need);

      const tl = performance.now();
      const slotTop = slotEl.getBoundingClientRect().top; // first geometry read forces the layout of the chunk
      this.stats.layoutMs += performance.now() - tl;
      let lastBottom = 0;
      for (; analyzed < recs.length; analyzed++) {
        const rec = recs[analyzed];
        const r = rec.el.getBoundingClientRect();
        const L = rec.style.leading * PT;
        const padTop = analyzed === 0 || rec.cont ? 0 : rec.style.before * PT;
        const padBot = rec.style.after * PT;
        const contentH = r.height - padTop - padBot;
        const nLines = Math.max(1, Math.round(contentH / L));
        // Regular paragraph: every line box is exactly one leading tall, so line i spans [top + i*L, top + (i+1)*L) and the
        // fit test is exact integer arithmetic. Irregular paragraph (a line pushed below a float that left too little
        // room, a fallback font that made one line taller): fall back to the real y of each line, which is accurate to
        // about half a pixel, so a small tolerance is used.
        const regular = Math.abs(contentH - nLines * L) < 0.05;
        const contentTopAbs = r.top + padTop;
        const nFit = regular ? Math.floor((H - (r.top - slotTop + padTop) + EPS) / L) : 0;
        const fitsCy: (cy: number) => boolean = regular
          ? (cy) => Math.floor((cy - contentTopAbs) / L) < nFit
          : (cy) => cy + L / 2 - slotTop <= H + IRREGULAR_TOL;
        const fitsAll = regular ? nFit >= nLines : r.bottom - padBot - slotTop <= H + IRREGULAR_TOL;
        lastBottom = r.bottom - slotTop;
        if (fitsAll) {
          lines += nLines;
          continue;
        }
        // the paragraph straddles the slot bottom (or does not fit at all): find where the last fitting line ends
        const tp = performance.now();
        const cut = regular && nFit <= 0 ? { e: 0, genHyphen: false } : this.findCut(rec, fitsCy);
        this.stats.probeMs += performance.now() - tp;
        if (cut.e === 0) {
          // not even the first line fits: cut before this paragraph
          if (analyzed === 0) return { ...base, end: startPos, empty: true, endMid: false, hy: false, lines: 0, frontier: startPos + 2 };
          const prev = recs[analyzed - 1];
          return { ...base, end: prev.para.ce, empty: false, endMid: false, hy: false, lines, frontier: prev.para.ce + 2 };
        }
        const { e, genHyphen } = cut;
        const off = rec.from - rec.para.cs + e;
        // A cut inside a word needs a drawn hyphen only if the ENGINE drew one here. A letter on both sides is not enough:
        // line breaks between ideographs (日|本) are not hyphenation. See findCut for how the engine's hyphen is detected.
        const around = rec.para.node.textBetween(Math.max(0, off - 1), off + 1);
        const hy = genHyphen && /^\p{L}\p{L}$/u.test(around);
        const text = rec.para.node.textContent;
        let w = off;
        while (w < text.length && !/\s/.test(text[w])) w++;
        // Chromium does not hyphenate the LAST word of a paragraph (observed: `hyphenation` wraps whole when it ends the
        // paragraph and becomes `hy-|phenation` as soon as anything follows it). So if the first word after the cut is the
        // paragraph's last word, an edit at the paragraph end (a join, an appended word) can move this cut: the frontier
        // then reaches the next paragraph's start.
        let t = w;
        while (t < text.length && /\s/.test(text[t])) t++;
        const frontier = t >= text.length ? rec.para.ce + 2 : rec.para.cs + w;
        return { ...base, end: rec.from + e, empty: false, endMid: true, hy, lines: lines + (regular ? nFit : 0), frontier };
      }
      if (next >= paras.length) {
        // the rest of the story fits: slot takes it all
        return { ...base, end: paras[paras.length - 1].ce, empty: false, endMid: false, hy: false, lines, frontier: paras[paras.length - 1].ce + 2 };
      }
      need = Math.max(H - lastBottom, 0) * 1.15 + 1;
    }
  }

  /**
   * Largest e (1 <= e < len) such that the line holding character e-1 fits (`fitsCy` decides from the centre y of a
   * character's rect), or e = 0 if even the first character's line does not fit. Also reports whether the engine drew a
   * hyphen at that break.
   */
  private findCut(rec: Rec, fitsCy: (cy: number) => boolean): { e: number; genHyphen: boolean } {
    const texts: { node: Text; start: number }[] = [];
    const walker = document.createTreeWalker(rec.el, NodeFilter.SHOW_TEXT);
    let acc = 0;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      texts.push({ node: n as Text, start: acc });
      acc += (n as Text).data.length;
    }
    const range = this.range;
    const charRects = (c: number): DOMRectList => {
      let lo = 0;
      let hi = texts.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (texts[mid].start <= c) lo = mid;
        else hi = mid - 1;
      }
      const t = texts[lo];
      range.setStart(t.node, c - t.start);
      range.setEnd(t.node, c - t.start + 1);
      this.stats.probes++;
      return range.getClientRects();
    };
    /** centre y of the line holding character c, or null if it has no rect at all */
    const cyOf = (c: number): number | null => {
      for (; c >= 0; c--) {
        const rects = charRects(c);
        if (rects.length) {
          // A one-char range that starts right after a hyphenation break returns TWO rects: the engine's generated
          // hyphen at the end of the previous line, then the character itself. The character is always the last one.
          const r = rects[rects.length - 1];
          return r.top + r.height / 2;
        }
      }
      return null;
    };
    const fits = (c: number) => {
      const cy = cyOf(c);
      return cy === null ? true : fitsCy(cy);
    };
    if (!fits(0)) return { e: 0, genHyphen: false };
    let lo = 1;
    let hi = rec.len - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (fits(mid - 1)) lo = mid;
      else hi = mid - 1;
    }
    // first char of the next line: two rects, the first one on the previous line, means a generated hyphen
    const next = charRects(lo);
    let genHyphen = false;
    if (next.length >= 2) {
      const a = next[0];
      const b = next[next.length - 1];
      genHyphen = b.top + b.height / 2 - (a.top + a.height / 2) > rec.style.leading * PT / 2;
    }
    return { e: lo, genHyphen };
  }
}
