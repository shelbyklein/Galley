// Node-side: extract lines from a printToPDF result with poppler's pdftotext -bbox-layout and compare them, line by line,
// with the lines the renderer measured on screen.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { normText } from '../../packages/render/src/text/norm';

export interface PdfWord {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  text: string;
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface LineLike {
  text: string;
  cy: number;
  left?: number;
  right?: number;
  pseudoHyphen?: boolean;
}

function bin(name: string): string {
  for (const d of ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin']) if (fs.existsSync(`${d}/${name}`)) return `${d}/${name}`;
  return name;
}

const unescapeXml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&');

export function pdfWords(pdfPath: string, page = 1): PdfWord[] {
  const xml = execFileSync(bin('pdftotext'), ['-bbox-layout', '-f', String(page), '-l', String(page), pdfPath, '-'], { encoding: 'utf8', maxBuffer: 256 << 20 });
  const out: PdfWord[] = [];
  for (const m of xml.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g)) {
    out.push({ x0: +m[1], y0: +m[2], x1: +m[3], y1: +m[4], text: unescapeXml(m[5]) });
  }
  return out;
}

export function pdfPageCount(pdfPath: string): number {
  const out = execFileSync(bin('pdfinfo'), [pdfPath], { encoding: 'utf8' });
  return Number(/Pages:\s+(\d+)/.exec(out)?.[1] ?? 0);
}

export function pdfLinesBySlot(words: PdfWord[], slots: Rect[]): LineLike[][] {
  const per: PdfWord[][] = slots.map(() => []);
  for (const w of words) {
    const cx = (w.x0 + w.x1) / 2;
    const cy = (w.y0 + w.y1) / 2;
    const k = slots.findIndex((s) => cx >= s.x - 2 && cx <= s.x + s.w + 2 && cy >= s.y - 2 && cy <= s.y + s.h + 2);
    if (k >= 0) per[k].push(w);
  }
  return per.map((ws) => {
    const sorted = ws.map((w) => ({ ...w, cy: (w.y0 + w.y1) / 2 })).sort((a, b) => a.cy - b.cy || a.x0 - b.x0);
    const groups: (typeof sorted)[] = [];
    for (const w of sorted) {
      const g = groups[groups.length - 1];
      if (g && Math.abs(g[0].cy - w.cy) < 5) g.push(w);
      else groups.push([w]);
    }
    return groups.map((g) => {
      g.sort((a, b) => a.x0 - b.x0);
      return { text: g.map((w) => normText(w.text)).join(' '), cy: g.reduce((s, w) => s + w.cy, 0) / g.length, left: g[0].x0, right: g[g.length - 1].x1 };
    });
  });
}

export interface Compare {
  ok: boolean;
  slots: number;
  domLines: number;
  pdfLines: number;
  mismatches: number;
  details: string[];
  /** vertical agreement: spread of (pdf y - dom y) over all matched lines, pt */
  dySpread: number;
  dyMean: number;
  dxMax: number;
}

export function compareLines(dom: LineLike[][], pdf: LineLike[][]): Compare {
  const details: string[] = [];
  let mism = 0;
  let nDom = 0;
  let nPdf = 0;
  const dys: number[] = [];
  let dxMax = 0;
  const n = Math.max(dom.length, pdf.length);
  for (let k = 0; k < n; k++) {
    const a = dom[k] ?? [];
    const b = pdf[k] ?? [];
    nDom += a.length;
    nPdf += b.length;
    if (a.length !== b.length) {
      mism++;
      details.push(`slot ${k}: ${a.length} screen lines vs ${b.length} pdf lines`);
    }
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      if (a[i].text !== b[i].text) {
        mism++;
        if (details.length < 12) details.push(`slot ${k} line ${i}: screen "${a[i].text}" vs pdf "${b[i].text}"`);
      } else {
        dys.push(b[i].cy - a[i].cy);
        if (a[i].left != null && b[i].left != null) {
          dxMax = Math.max(dxMax, Math.abs(a[i].left! - b[i].left!));
          // a ::after hyphen is not in any DOM text rect, so the screen-side right edge excludes it
          if (!a[i].pseudoHyphen) dxMax = Math.max(dxMax, Math.abs(a[i].right! - b[i].right!));
        }
      }
    }
  }
  const mean = dys.reduce((s, v) => s + v, 0) / (dys.length || 1);
  const spread = dys.reduce((m, v) => Math.max(m, Math.abs(v - mean)), 0);
  return { ok: mism === 0 && nDom > 0, slots: n, domLines: nDom, pdfLines: nPdf, mismatches: mism, details, dySpread: spread, dyMean: mean, dxMax };
}

export function pdfInfo(pdfPath: string): { pages: number; width: number; height: number } {
  const out = execFileSync(bin('pdfinfo'), [pdfPath], { encoding: 'utf8' });
  const m = /Page size:\s+([\d.]+) x ([\d.]+) pts/.exec(out);
  return { pages: Number(/Pages:\s+(\d+)/.exec(out)?.[1] ?? 0), width: m ? +m[1] : 0, height: m ? +m[2] : 0 };
}

/** Rows of `pdffonts`: { name, type, emb } */
export function pdfFonts(pdfPath: string): { name: string; type: string; emb: boolean }[] {
  const out = execFileSync(bin('pdffonts'), [pdfPath], { encoding: 'utf8' }).split('\n').slice(2).filter(Boolean);
  return out.map((l) => {
    const m = /^(\S+)\s+(.+?)\s+(?:Identity-H|WinAnsi|MacRoman|Custom|Builtin|\S+)\s+(yes|no)\s+(yes|no)\s+(yes|no)\s+\d+/.exec(l);
    return { name: l.split(/\s+/)[0], type: m ? m[2].trim() : l, emb: m ? m[3] === 'yes' : false };
  });
}
