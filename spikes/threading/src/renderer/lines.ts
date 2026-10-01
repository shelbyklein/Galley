// Independent "ground truth" line extraction from the real, rendered frames. Deliberately uses a different technique
// from the engine's measurement (one Range per *word* instead of binary-searching characters) so that the tests
// compare two methods rather than the engine against itself.
import { PT, styleOf } from '../shared/styles';
import { normText } from '../shared/norm';

export interface DomLine {
  slot: number;
  para: number;
  text: string; // normalised words joined by single spaces; a generated hyphen at a line end is written as '-'
  words: string[];
  top: number; // line box, pt, page coordinates
  bottom: number;
  left: number;
  right: number;
  cy: number; // glyph box centre, pt
  pseudoHyphen: boolean; // the line ends in a ::after hyphen (not part of any text rect, so `right` excludes it)
}

export { normText };

interface Piece {
  text: string;
  cy: number;
  left: number;
  right: number;
  broken: boolean; // a non-final piece of a word that was split across lines by hyphenation
  final: boolean;
}

export function extractLines(pageEl: HTMLElement, rootEl: HTMLElement): DomLine[][] {
  const pageRect = pageEl.getBoundingClientRect();
  const slotEls = [...rootEl.children].filter((e) => (e as HTMLElement).classList.contains('slot')) as HTMLElement[];
  const out: DomLine[][] = [];
  for (const slotEl of slotEls) {
    const slotIdx = Number(slotEl.dataset.slot);
    const lines: DomLine[] = [];
    [...slotEl.children].filter((c) => c.tagName === 'P').forEach((pEl, pi) => {
      const p = pEl as HTMLElement;
      const style = styleOf(p.dataset.style || 'body');
      const L = style.leading * PT;
      const pr = p.getBoundingClientRect();
      const cs = getComputedStyle(p);
      const contentTop = pr.top + parseFloat(cs.paddingTop);
      // concatenated text + node map
      const texts: { node: Text; start: number }[] = [];
      let full = '';
      const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        texts.push({ node: n as Text, start: full.length });
        full += (n as Text).data;
      }
      const loc = (off: number, end: boolean) => {
        // choose the node so that a range END at a node boundary sticks to the earlier node
        for (let i = texts.length - 1; i >= 0; i--) {
          const t = texts[i];
          if (end ? off > t.start : off >= t.start) return { node: t.node, offset: off - t.start };
        }
        return { node: texts[0].node, offset: 0 };
      };
      const rangeOf = (a: number, b: number) => {
        const r = document.createRange();
        const s = loc(a, false);
        const e = loc(b, true);
        r.setStart(s.node, s.offset);
        r.setEnd(e.node, e.offset);
        return r;
      };
      const clusterY = (rects: DOMRect[]) => {
        const ys: number[] = [];
        for (const r of rects) {
          const cy = r.top + r.height / 2;
          if (!ys.some((y) => Math.abs(y - cy) < L / 2)) ys.push(cy);
        }
        return ys.sort((a, b) => a - b);
      };
      const pieces: Piece[] = [];
      const re = /\S+/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(full))) {
        const w = m[0];
        const rects = [...rangeOf(m.index, m.index + w.length).getClientRects()].filter((r) => r.width > 0);
        if (!rects.length) continue;
        const ys = clusterY(rects);
        if (ys.length === 1) {
          pieces.push({ text: w, cy: ys[0], left: Math.min(...rects.map((r) => r.left)), right: Math.max(...rects.map((r) => r.right)), broken: false, final: true });
        } else {
          // word broken across lines: find the break(s) character by character
          let cur: { text: string; cy: number; left: number; right: number } | null = null;
          const parts: { text: string; cy: number; left: number; right: number }[] = [];
          for (let c = 0; c < w.length; c++) {
            // last rect: after a hyphenation break the first rect is the generated hyphen on the previous line
            const crs = [...rangeOf(m.index + c, m.index + c + 1).getClientRects()].filter((r) => r.width > 0);
            const cr = crs[crs.length - 1];
            if (!cr) {
              if (cur) cur.text += w[c];
              continue;
            }
            const cy = cr.top + cr.height / 2;
            if (!cur || Math.abs(cur.cy - cy) >= L / 2) {
              cur = { text: '', cy, left: cr.left, right: cr.right };
              parts.push(cur);
            }
            cur.text += w[c];
            cur.right = Math.max(cur.right, cr.right);
          }
          parts.forEach((pt, i) => pieces.push({ ...pt, broken: i < parts.length - 1, final: i === parts.length - 1 }));
        }
      }
      // group pieces into lines by cy
      pieces.sort((a, b) => a.cy - b.cy || a.left - b.left);
      const groups: Piece[][] = [];
      for (const pc of pieces) {
        const g = groups[groups.length - 1];
        if (g && Math.abs(g[0].cy - pc.cy) < L / 2) g.push(pc);
        else groups.push([pc]);
      }
      groups.forEach((g, gi) => {
        g.sort((a, b) => a.left - b.left);
        const words = g.map((pc) => {
          let t = pc.text;
          if (pc.broken && /[\p{L}\p{N}]$/u.test(t)) t += '-'; // engine-drawn hyphen
          return t;
        });
        if (gi === groups.length - 1 && p.classList.contains('hy')) words[words.length - 1] += '-'; // ::after hyphen at a slot end
        const cy = g[0].cy;
        // Line box top: on the regular leading grid when the line sits on it (exact), otherwise (a line pushed below a
        // float, a taller line) from the measured glyph centre, which is accurate to about half a pixel.
        const rel = (cy - contentTop) / L;
        const li = Math.floor(rel);
        const onGrid = Math.abs(rel - (li + 0.5)) * L < 1.25;
        const top = onGrid ? contentTop + li * L : cy - L / 2;
        lines.push({
          slot: slotIdx,
          para: pi,
          words: words.map(normText),
          text: words.map(normText).join(' '),
          top: (top - pageRect.top) / PT,
          bottom: (top + L - pageRect.top) / PT,
          left: (Math.min(...g.map((x) => x.left)) - pageRect.left) / PT,
          right: (Math.max(...g.map((x) => x.right)) - pageRect.left) / PT,
          cy: (cy - pageRect.top) / PT,
          pseudoHyphen: gi === groups.length - 1 && p.classList.contains('hy'),
        });
      });
    });
    out[slotIdx] = lines;
  }
  return out;
}
