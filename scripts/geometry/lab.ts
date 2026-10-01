// The geometry lab: the candidates P1-04 compared, printed with the same printToPDF options as the export and measured in
// the PDF. The chosen method must stay exact (asserted); the others are measured so the decision in
// packages/render/GEOMETRY.md can be checked again when Chromium changes.
import { measurePdfGeometry, type PdfGeometry } from '@galley/prepress/verify';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface Row {
  section: string;
  item: string;
  measured: string;
  limit: string;
  /** null: informational, not asserted. */
  pass: boolean | null;
}

const ROOT = path.resolve(__dirname, '../..');
const FONT = require.resolve('@fontsource/inter/files/inter-latin-400-normal.woff2', { paths: [ROOT] });
const PHOTO = path.join(ROOT, 'fixtures/poster-basic.galley/assets/photo.jpg');
const TOLERANCE = 0.05;

interface Job {
  html: string;
  pdf: string;
}

/** Print each job's HTML to its PDF in one Electron run. */
function printAll(jobs: Job[], dir: string): void {
  const jobFile = path.join(dir, 'jobs.json');
  fs.writeFileSync(jobFile, JSON.stringify(jobs));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const electron = require('electron') as unknown as string;
  const r = spawnSync(electron, [path.join(__dirname, 'lab-print.cjs'), jobFile], { env, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`lab-print failed:\n${r.stderr}`);
}

const sheet = (body: string, css = '') =>
  `<!doctype html><meta charset="utf-8"><style>@font-face{font-family:Lab;src:url("file://${FONT}")}@page{size:600pt 400pt;margin:0}html,body{margin:0}.sheet{position:relative;width:600pt;height:400pt;overflow:hidden}${css}</style><div class="sheet">${body}</div>`;

type Frame = [x: number, y: number, w: number, h: number];
/** Positions on whole CSS pixels and not: 36 pt = 48 px and 99 pt = 132 px are exact; the rest are not. */
const FRAMES: Frame[] = [
  [36, 99, 100, 60],
  [36.3, 99.1, 100.1, 60.1],
  [150.37, 100.13, 100.1, 60.1],
  [270.55, 200.77, 90.3, 40.4],
  [250.55, 99.55, 100.1, 60.1],
];
/** Inter 12 pt on 18 pt leading: the first baseline is 18 px = 13.5 pt below the frame top. */
const BASELINE = 13.5;
const textCss = `font:12pt/18pt Lab;color:rgb(10,10,25);white-space:pre;`;

type Method = { id: string; label: string; make: (f: Frame, i: number) => string };
const px = (pt: number) => (pt * 4) / 3;
const TEXT_METHODS: Method[] = [
  { id: 'left-top', label: 'left/top in pt', make: ([x, y, w, h], i) => `<div style="position:absolute;left:${x}pt;top:${y}pt;width:${w}pt;height:${h}pt;${textCss}">Hxg ${i}</div>` },
  {
    id: 'transform',
    label: 'translate() from the origin',
    make: ([x, y, w, h], i) => `<div style="position:absolute;left:0;top:0;transform:translate(${x}pt,${y}pt);width:${w}pt;height:${h}pt;${textCss}">Hxg ${i}</div>`,
  },
  {
    id: 'whole-px + translate',
    label: 'left/top in whole px + translate() for the rest',
    make: ([x, y, w, h], i) => {
      const ix = Math.floor(px(x));
      const iy = Math.floor(px(y));
      return `<div style="position:absolute;left:${ix}px;top:${iy}px;transform:translate(${(px(x) - ix) * 0.75}pt,${(px(y) - iy) * 0.75}pt);width:${w}pt;height:${h}pt;${textCss}">Hxg ${i}</div>`;
    },
  },
  {
    id: 'foreignObject',
    label: 'SVG foreignObject at x, y',
    make: ([x, y, w, h], i) =>
      `<svg style="position:absolute;left:0;top:0;overflow:visible" width="1px" height="1px"><foreignObject x="${x}pt" y="${y}pt" width="${w}pt" height="${h}pt"><div xmlns="http://www.w3.org/1999/xhtml" style="${textCss}width:${w}pt;height:${h}pt">Hxg ${i}</div></foreignObject></svg>`,
  },
];

const CLIP_METHODS: Method[] = [
  { id: 'overflow:hidden', label: 'overflow: hidden', make: ([x, y, w, h], i) => `<div style="position:absolute;left:0;top:0;transform:translate(${x}pt,${y}pt);width:${w}pt;height:${h}pt;overflow:hidden;${textCss}">Hxg ${i}</div>` },
  { id: 'clip-path', label: 'clip-path: inset(0)', make: ([x, y, w, h], i) => `<div style="position:absolute;left:0;top:0;transform:translate(${x}pt,${y}pt);width:${w}pt;height:${h}pt;clip-path:inset(0);${textCss}">Hxg ${i}</div>` },
];

/** Content of the image test: the picture is 1.5 x the frame, offset by (-3.3, -2.2) pt. */
const IMG: Frame = [36.3, 99.1, 200.1, 106.7];
const IMG_OFFSET: [number, number, number, number] = [-3.3, -2.2, 300.15, 160.05];
const IMAGE_METHODS: Method[] = [
  {
    id: 'left-top pt',
    label: 'frame left/top, <img> left/top/width/height in pt, overflow: hidden',
    make: ([x, y, w, h]) =>
      `<div style="position:absolute;left:${x}pt;top:${y}pt;width:${w}pt;height:${h}pt;overflow:hidden"><img src="file://${PHOTO}" style="position:absolute;display:block;max-width:none;left:${IMG_OFFSET[0]}pt;top:${IMG_OFFSET[1]}pt;width:${IMG_OFFSET[2]}pt;height:${IMG_OFFSET[3]}pt"></div>`,
  },
  {
    id: 'transform + scale',
    label: 'frame translate + clip-path; <img> at natural pixel size, translate + scale',
    make: ([x, y, w, h]) =>
      `<div style="position:absolute;left:0;top:0;transform:translate(${x}pt,${y}pt);width:${w}pt;height:${h}pt;clip-path:inset(0)"><img src="file://${PHOTO}" style="position:absolute;display:block;max-width:none;transform-origin:0 0;left:0;top:0;width:2400px;height:1280px;transform:translate(${IMG_OFFSET[0]}pt,${IMG_OFFSET[1]}pt) scale(${IMG_OFFSET[2] / 1800},${IMG_OFFSET[3] / 960})"></div>`,
  },
];

function measure(dir: string, name: string): Promise<PdfGeometry> {
  return measurePdfGeometry(fs.readFileSync(path.join(dir, `${name}.pdf`)));
}

const f2 = (n: number) => n.toFixed(3);

export async function runLab(): Promise<Row[]> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'galley-geometry-lab-'));
  const rows: Row[] = [];
  try {
    const jobs: Job[] = [];
    const job = (name: string, html: string) => {
      fs.writeFileSync(path.join(dir, `${name}.html`), html);
      jobs.push({ html: path.join(dir, `${name}.html`), pdf: path.join(dir, `${name}.pdf`) });
    };
    for (const m of TEXT_METHODS) job(`text-${m.id}`, sheet(FRAMES.map((f, i) => m.make(f, i)).join('')));
    for (const m of CLIP_METHODS) job(`clip-${m.id}`, sheet(FRAMES.map((f, i) => m.make(f, i)).join('')));
    for (const m of IMAGE_METHODS) job(`image-${m.id}`, sheet(m.make(IMG, 0)));
    printAll(jobs, dir);

    // ---- text origins: the glyph origin of the first baseline, against frame x and frame y + 13.5 pt
    for (const m of TEXT_METHODS) {
      const g = await measure(dir, `text-${m.id}`);
      const firsts = FRAMES.map((_, i) => g.texts.find((t) => t.block === i)!);
      const ex = Math.max(...firsts.map((t, i) => Math.abs(t.x - FRAMES[i]![0])));
      const ey = Math.max(...firsts.map((t, i) => Math.abs(t.y - (FRAMES[i]![1] + BASELINE))));
      const chosen = m.id === 'transform';
      rows.push({ section: 'text frame origin', item: m.label, measured: `x ${f2(ex)} pt, y ${f2(ey)} pt`, limit: chosen ? `<= ${TOLERANCE} pt (chosen)` : '(not chosen)', pass: chosen ? ex <= TOLERANCE && ey <= TOLERANCE : null });
    }

    // ---- clips: size of the clip rectangle against the frame size
    for (const m of CLIP_METHODS) {
      const g = await measure(dir, `clip-${m.id}`);
      const clips = g.clips.filter((c) => c.x1 - c.x0 < 300 && c.y1 - c.y0 < 100);
      const err = Math.max(...clips.map((c, i) => Math.max(Math.abs(c.x1 - c.x0 - FRAMES[i]![2]), Math.abs(c.y1 - c.y0 - FRAMES[i]![3]))));
      const chosen = m.id === 'clip-path';
      rows.push({ section: 'frame clip', item: m.label, measured: `clip size error up to ${f2(err)} pt (${clips.length} clips)`, limit: chosen ? '<= 0.02 pt (chosen)' : '(not chosen)', pass: chosen ? clips.length === FRAMES.length && err <= 0.02 : null });
    }

    // ---- images
    const expectImg = { x0: IMG[0] + IMG_OFFSET[0], y0: IMG[1] + IMG_OFFSET[1], x1: IMG[0] + IMG_OFFSET[0] + IMG_OFFSET[2], y1: IMG[1] + IMG_OFFSET[1] + IMG_OFFSET[3] };
    for (const m of IMAGE_METHODS) {
      const g = await measure(dir, `image-${m.id}`);
      const b = g.images[0]!;
      const err = Math.max(Math.abs(b.x0 - expectImg.x0), Math.abs(b.y0 - expectImg.y0), Math.abs(b.x1 - expectImg.x1), Math.abs(b.y1 - expectImg.y1));
      const chosen = m.id === 'transform + scale';
      rows.push({ section: 'image placement', item: m.label, measured: `edge error up to ${f2(err)} pt`, limit: chosen ? `<= ${TOLERANCE} pt (chosen)` : '(not chosen)', pass: chosen ? err <= TOLERANCE : null });
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return rows;
}

// ------------------------------------------------------------------------------------------------------------ page size

/** Sheets to try: common sizes with and without bleed, odd fractions, and a spread of pseudo-random sizes. */
function sheetSizes(): [number, number][] {
  const sizes: [number, number][] = [
    [612, 792],
    [864, 1296],
    [792 + 18, 1224 + 18],
    [595.276 + 18, 841.89 + 18],
    [595.276, 841.89],
    [594.96, 841.92],
    [684.5, 500.3],
    [100.05, 100.05],
    [1728, 2592],
    [1730.4, 2600.2],
  ];
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < 90; i++) sizes.push([Math.round((100 + rand() * 1900) * 100) / 100, Math.round((100 + rand() * 1900) * 100) / 100]);
  return sizes;
}

/**
 * The page-size rule: ask Chromium for the `@page` size the export page uses (ceil(sheet) + 1 whole points) and for the
 * sheet itself, and read the MediaBox back. The requested size must always give a page at least as large as the sheet.
 */
export async function runPageSize(): Promise<Row[]> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'galley-geometry-size-'));
  try {
    const sizes = sheetSizes();
    const jobs: Job[] = [];
    sizes.forEach(([w, h], i) => {
      for (const [kind, pw, ph] of [
        ['exact', w, h],
        ['ours', Math.ceil(w) + 1, Math.ceil(h) + 1],
      ] as const) {
        const html = `<!doctype html><meta charset="utf-8"><style>@page{size:${pw}pt ${ph}pt;margin:0}html,body{margin:0}.sheet{position:relative;width:${w}pt;height:${h}pt;overflow:hidden;background:rgb(10,10,25)}</style><div class="sheet"></div>`;
        fs.writeFileSync(path.join(dir, `${kind}-${i}.html`), html);
        jobs.push({ html: path.join(dir, `${kind}-${i}.html`), pdf: path.join(dir, `${kind}-${i}.pdf`) });
      }
    });
    printAll(jobs, dir);
    const media = (name: string) => {
      const s = fs.readFileSync(path.join(dir, `${name}.pdf`)).toString('latin1');
      const m = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(s)!;
      return [Number(m[1]), Number(m[2])] as const;
    };
    let exactMin = Infinity;
    let exactMax = -Infinity;
    let oursMin = Infinity;
    let oursMax = -Infinity;
    let allLarger = true;
    let pages = 0;
    sizes.forEach(([w, h], i) => {
      const [ew, eh] = media(`exact-${i}`);
      const [ow, oh] = media(`ours-${i}`);
      for (const d of [ew - w, eh - h]) {
        exactMin = Math.min(exactMin, d);
        exactMax = Math.max(exactMax, d);
      }
      for (const d of [ow - w, oh - h]) {
        oursMin = Math.min(oursMin, d);
        oursMax = Math.max(oursMax, d);
      }
      if (ow < w || oh < h) allLarger = false;
      pages += (fs.readFileSync(path.join(dir, `ours-${i}.pdf`)).toString('latin1').match(/\/Type\s*\/Page\b/g) ?? []).length;
    });
    return [
      { section: 'page size', item: `Chromium page vs the sheet when asking for the sheet itself (${sizes.length} sizes)`, measured: `${exactMin.toFixed(2)} to ${exactMax.toFixed(2)} pt`, limit: '(documented: rounds to whole points, either way)', pass: null },
      { section: 'page size', item: 'Chromium page vs the sheet when asking for ceil(sheet) + 1 pt', measured: `${oursMin.toFixed(2)} to ${oursMax.toFixed(2)} pt, one page each (${pages} pages)`, limit: 'never smaller than the sheet', pass: allLarger && pages === sizes.length },
    ];
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
