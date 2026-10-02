// The golden checks: what an exported PDF must satisfy, derived from the document it was exported from.
//
// Structure (boxes, PDF/X-4 plumbing, qpdf), fonts, leftover RGB, and, from Ghostscript's `tiffsep` plates, the ink:
//   - every flat patch of a swatch reads its ink within +/-2 percentage points, and a spot color is on its own plate
//   - 100K black text is K only; knockout text removes the ink beneath, overprint text keeps it (and does not leak)
//   - paper-colored text knocks out; colored text reads its own ink
//   - art reaches the bleed edge and is cut there (or at the trim edge with bleed off)
//   - crop marks print on every plate (/Separation /All) and are absent when off
// Regions come from the model's frame geometry, so the checks follow whatever the fixture contains. Ported from the press
// spike's verify.ts, which hard-coded the regions of one page.
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream } from '@cantoo/pdf-lib';
import { buildSentinelTable, isLayerVisible, paintOrder, resolveInk, type Frame, type GalleyDocument, type Id, type Ink, type Paint } from '@galley/model';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { exportPage, pageBoxes, type ExportOptions } from '../geometry.ts';
import { marksLayout } from '../marks.ts';
import { scanRgb } from './rgbscan.ts';
import { measureRegion, separate, DEFAULT_DPI, type Measure, type Rect, type Separations } from './separations.ts';

export interface Check {
  group: string;
  name: string;
  expected: string;
  measured: string;
  pass: boolean;
}

export interface GoldenInput {
  /** The exported PDF. */
  pdfPath: string;
  /** The document that was exported (not the export copy). */
  doc: GalleyDocument;
  options: ExportOptions;
  pageId?: Id;
  /** Where to write the separations. */
  workDir: string;
  /** `rgb-icc` photos are ICC-tagged RGB: allowed in PDF/X-4, so they are not "leftover RGB". */
  photoMode?: 'cmyk' | 'rgb-icc';
  dpi?: number;
  /**
   * Chromium's PDF before prepress and the output profile: when both are given, the photos are compared with Ghostscript's
   * own conversion of the original RGB image through the same profile.
   */
  photoReference?: { chromiumPdfPath: string; outputProfilePath: string };
}

const TOL = 2; // percentage points of ink
const f1 = (n: number) => n.toFixed(1);
const within = (v: number, e: number, tol = TOL) => Math.abs(v - e) <= tol;

// ------------------------------------------------------------------------------------------------------------ inks

type PlateValues = { C: number; M: number; Y: number; K: number; spots: Record<string, number> };

/** The ink a paint prints as, by plate: a CMYK swatch at its tint, or a spot color on its own plate at its tint. */
export function expectedPlates(ink: Pick<Ink, 'model' | 'values' | 'tint' | 'name'>): PlateValues {
  if (ink.model === 'spot') return { C: 0, M: 0, Y: 0, K: 0, spots: { [ink.name]: ink.tint } };
  const [c, m, y, k] = ink.values.map((v) => (v * ink.tint) / 100) as [number, number, number, number];
  return { C: c, M: m, Y: y, K: k, spots: {} };
}

const isPaper = (p: PlateValues) => p.C + p.M + p.Y + p.K === 0 && Object.values(p.spots).every((v) => v === 0);
const isBlack100 = (ink: Ink) => ink.model === 'cmyk' && ink.values[0] === 0 && ink.values[1] === 0 && ink.values[2] === 0 && ink.values[3] === 100 && ink.tint === 100;

function describePlates(p: PlateValues): string {
  const spots = Object.entries(p.spots).map(([n, v]) => ` ${n} ${f1(v)}`).join('');
  return `C${f1(p.C)} M${f1(p.M)} Y${f1(p.Y)} K${f1(p.K)}${spots}`;
}

function describeMeasure(m: Measure, key: 'mean' | 'max' = 'mean'): string {
  const spots = Object.entries(m.spots).map(([n, v]) => ` ${n} ${f1(v[key])}`).join('');
  return `C${f1(m[key].C)} M${f1(m[key].M)} Y${f1(m[key].Y)} K${f1(m[key].K)}${spots}`;
}

/** Whether a measured mean matches the expected plates on every plate, spots included (a missing spot plate reads 0). */
function matches(m: Measure, e: PlateValues, tol = TOL): boolean {
  if (!(within(m.mean.C, e.C, tol) && within(m.mean.M, e.M, tol) && within(m.mean.Y, e.Y, tol) && within(m.mean.K, e.K, tol))) return false;
  const names = new Set([...Object.keys(m.spots), ...Object.keys(e.spots)]);
  for (const n of names) if (!within(m.spots[n]?.mean ?? 0, e.spots[n] ?? 0, tol)) return false;
  return true;
}

// -------------------------------------------------------------------------------------------------------- geometry

/** Points from the top-left of the sheet. */
interface PtRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
const intersects = (a: PtRect, b: PtRect) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const shrink = (r: PtRect, f: number): PtRect => {
  const cx = (r.x0 + r.x1) / 2;
  const cy = (r.y0 + r.y1) / 2;
  return { x0: cx - ((r.x1 - r.x0) / 2) * f, y0: cy - ((r.y1 - r.y0) / 2) * f, x1: cx + ((r.x1 - r.x0) / 2) * f, y1: cy + ((r.y1 - r.y0) / 2) * f };
};
const insideRect = (outer: PtRect, inner: PtRect) => inner.x0 >= outer.x0 && inner.y0 >= outer.y0 && inner.x1 <= outer.x1 && inner.y1 <= outer.y1;
const insideEllipse = (box: PtRect, inner: PtRect) => {
  const cx = (box.x0 + box.x1) / 2;
  const cy = (box.y0 + box.y1) / 2;
  const rx = (box.x1 - box.x0) / 2;
  const ry = (box.y1 - box.y0) / 2;
  return [
    [inner.x0, inner.y0],
    [inner.x1, inner.y0],
    [inner.x0, inner.y1],
    [inner.x1, inner.y1],
  ].every(([x, y]) => ((x! - cx) / rx) ** 2 + ((y! - cy) / ry) ** 2 <= 1);
};

interface Placed {
  frame: Exclude<Frame, { type: 'group' }>;
  box: PtRect;
  index: number;
}

const colorFrame = (f: Placed['frame']): Paint | null => (f.type === 'line' ? null : f.fill);

// -------------------------------------------------------------------------------------------------------- the checks

export async function runGoldenChecks(input: GoldenInput): Promise<Check[]> {
  const { doc, options } = input;
  const dpi = input.dpi ?? DEFAULT_DPI;
  const pageId = input.pageId ?? doc.pageOrder[0]!;
  const page = exportPage(doc.pages[pageId]!, options);
  const boxes = pageBoxes(page);
  const ox = boxes.trim.x;
  const oy = boxes.trim.y;
  const checks: Check[] = [];
  const check = (group: string, name: string, expected: string, measured: string, pass: boolean) => checks.push({ group, name, expected, measured, pass });

  checks.push(...(await structureChecks(input.pdfPath, boxes, options)));
  checks.push(...(await rgbChecks(input.pdfPath, input.photoMode ?? 'cmyk')));

  // ---- the plates
  const seps = await separate(input.pdfPath, path.join(input.workDir, 'sep'), dpi);
  const s = seps.scale;
  const px = (r: PtRect): Rect => ({ x: r.x0 * s, y: r.y0 * s, w: (r.x1 - r.x0) * s, h: (r.y1 - r.y0) * s });
  const sheetRect = (x0: number, y0: number, x1: number, y1: number): PtRect => ({ x0: ox + x0, y0: oy + y0, x1: ox + x1, y1: oy + y1 });
  const region = (r: PtRect, pred?: (i: number) => boolean) => measureRegion(seps, px(r), pred);

  const exportDoc = { ...doc, pages: { ...doc.pages, [pageId]: page } };
  const spotNames = [...new Set(buildSentinelTable(exportDoc).filter((e) => e.model === 'spot').map((e) => e.name))];
  const plateNames = Object.keys(seps.spots).sort();
  check('spot', 'spot colors have their own named plates', spotNames.join(', ') || '(none)', plateNames.join(', ') || '(none)', JSON.stringify(plateNames) === JSON.stringify([...spotNames].sort()));

  const frames: Placed[] = paintOrder(doc, pageId)
    .filter((f) => isLayerVisible(doc, f.layerId))
    .map((frame, index) => ({ frame, index, box: sheetRect(frame.x, frame.y, frame.x + frame.w, frame.y + frame.h) }));
  const upright = (p: Placed) => p.frame.rotation === 0;
  const inkOf = (paint: Paint) => resolveInk(doc, paint);
  const label = (p: Placed) => p.frame.name || p.frame.id;

  // the part of the sheet that prints: the bleed box (the export clips to it)
  const visible: PtRect = sheetRect(-page.bleed.left, -page.bleed.top, page.width + page.bleed.right, page.height + page.bleed.bottom);

  // ---- flat patches: rects and ellipses with a fill, in the part nothing else paints over
  for (const p of frames.filter((q) => (q.frame.type === 'rect' || q.frame.type === 'ellipse') && q.frame.fill && upright(q))) {
    const ink = inkOf(p.frame.fill!);
    const later = frames.filter((q) => q.index > p.index);
    const edge = Math.max(4, (p.frame.stroke?.weight ?? 0) + 2);
    const w = p.box.x1 - p.box.x0;
    const h = p.box.y1 - p.box.y0;
    const size = 16;
    const candidates: PtRect[] =
      p.frame.type === 'ellipse'
        ? [shrink(p.box, 0.55)]
        : [
            shrink(p.box, 0.5),
            { x0: p.box.x0 + edge, y0: p.box.y0 + edge, x1: p.box.x0 + edge + size, y1: p.box.y0 + edge + size },
            { x0: p.box.x1 - edge - size, y0: p.box.y1 - edge - size, x1: p.box.x1 - edge, y1: p.box.y1 - edge },
            { x0: p.box.x0 + w / 2 - size / 2, y0: p.box.y1 - edge - size, x1: p.box.x0 + w / 2 + size / 2, y1: p.box.y1 - edge },
          ];
    const usable = candidates.filter((c) => c.x1 - c.x0 >= 4 && c.y1 - c.y0 >= 4 && insideRect(visible, c) && !later.some((l) => intersects(l.box, shrink(c, 1.1))));
    if (h < 6 || w < 6 || usable.length === 0) continue;
    const e = expectedPlates(ink);
    // up to two regions per patch (the first one catches the value, a second one that the patch is uniform)
    for (const [i, c] of usable.slice(0, 2).entries()) {
      const m = region(c);
      check('ink', `${label(p)}${i ? ` (corner ${i})` : ''}: ${ink.name}${ink.tint < 100 ? ` at ${ink.tint}%` : ''}`, describePlates(e), describeMeasure(m), matches(m, e));
    }
  }

  // ---- text
  for (const t of frames.filter((q) => q.frame.type === 'text' && upright(q))) {
    const story = doc.stories[(t.frame as Extract<Frame, { type: 'text' }>).storyId];
    if (!story || !(story.doc.content ?? []).some((pp) => (pp.content ?? []).length > 0)) continue;
    const x = inkOf(story.defaults.fill);
    const xe = expectedPlates(x);
    // the background: the first frame under the text that overlaps it must be a fill that covers it (after shrinking the
    // text box toward its center); anything else under or over it makes the region unknown, and it is skipped
    let region_: PtRect | null = null;
    let bg: Ink | null = null;
    for (const f of [1, 0.8, 0.65, 0.5, 0.4]) {
      const r = shrink(t.box, f);
      const later = frames.filter((q) => q.index > t.index && intersects(q.box, r));
      if (later.length > 0) continue;
      const below = [...frames].filter((q) => q.index < t.index && intersects(q.box, r)).sort((a, b) => b.index - a.index)[0];
      if (!below) {
        region_ = insideRect(visible, r) ? r : null;
        bg = null;
        break;
      }
      const fill = colorFrame(below.frame);
      const covers = below.frame.type === 'rect' ? insideRect(below.box, r) : below.frame.type === 'ellipse' ? insideEllipse(below.box, r) : below.frame.type === 'text' && insideRect(below.box, r);
      if (fill && covers && upright(below) && insideRect(visible, r)) {
        region_ = r;
        bg = inkOf(fill);
        break;
      }
    }
    if (!region_) continue;
    const underlay = bg ? expectedPlates(bg) : null;
    const name = `${label(t)}: text`;

    if (isBlack100(x) && !x_overprint(story.defaults.fill) && !underlay) {
      const m = region(region_);
      const others = Math.max(m.max.C, m.max.M, m.max.Y, ...Object.values(m.spots).map((v) => v.max));
      check('black', `${name} on paper is K only: the C, M, Y and spot plates are empty`, 'max 0.0', describeMeasure(m, 'max'), others === 0);
      check('black', `${name} on paper: the Black plate carries the ink`, 'K max >= 99', `K max ${f1(m.max.K)}`, m.max.K >= 99);
      continue;
    }

    // Glyph interiors: the pixels where the text's own dominant plate is (nearly) full. Anti-aliased edges are left out.
    const driver = driverPlate(xe);
    if (!driver && isPaper(xe) && underlay && !isPaper(underlay)) {
      // paper-colored text over an ink: it knocks the ink out, so the ink's plate has both pixels at full strength and at 0
      const dom = dominantPlate(underlay)!;
      const m = region(region_);
      const lo = plateStat(m, dom, 'min');
      const hi = plateStat(m, dom, 'max');
      check('knockout', `${name} in [Paper] knocks ${dom} out of the ${bg!.name} beneath`, `min ~0 and max ~${f1(plateValue(underlay, dom))}`, `min ${f1(lo)}, max ${f1(hi)}`, lo <= 1 && within(hi, plateValue(underlay, dom)));
      continue;
    }
    if (!driver) continue;
    const full = plateValue(xe, driver) - 1.5;
    const pred = (i: number) => plateAt(seps, driver, i) >= full;
    const m = region(region_, pred);
    const over = x_overprint(story.defaults.fill);
    let expected = xe;
    let what: string;
    if (underlay && !isPaper(underlay) && over) {
      // overprint (OPM 1): every plate where the text has ink takes the text's value; the others keep what is beneath
      expected = { C: xe.C > 0 ? xe.C : underlay.C, M: xe.M > 0 ? xe.M : underlay.M, Y: xe.Y > 0 ? xe.Y : underlay.Y, K: xe.K > 0 ? xe.K : underlay.K, spots: { ...underlay.spots, ...Object.fromEntries(Object.entries(xe.spots).filter(([, v]) => v > 0)) } };
      what = `overprint: keeps the ${bg!.name} beneath`;
    } else if (underlay && !isPaper(underlay)) {
      what = `knockout: removes the ${bg!.name} beneath`;
    } else what = 'on paper';
    check(over && underlay ? 'overprint' : underlay ? 'knockout' : 'ink', `${name} (${x.name}) ${what} (${m.n} px)`, describePlates(expected), describeMeasure(m), m.n >= 40 && matches(m, expected));
  }

  // ---- bleed: art reaches the bleed edge and no further (with bleed off: the trim edge)
  type Side = 'left' | 'right' | 'top' | 'bottom';
  /** A 16 pt long band along a side, from `a` to `b` points outward from that side's bleed edge (negative: inside it). */
  const band = (side: Side, a: number, b: number, along: number): PtRect => {
    const edge = { left: -page.bleed.left, right: page.width + page.bleed.right, top: -page.bleed.top, bottom: page.height + page.bleed.bottom }[side];
    if (side === 'left') return sheetRect(edge - b, along, edge - a, along + 16);
    if (side === 'right') return sheetRect(edge + a, along, edge + b, along + 16);
    if (side === 'top') return sheetRect(along, edge - b, along + 16, edge - a);
    return sheetRect(along, edge + a, along + 16, edge + b);
  };
  const where = options.bleed ? 'bleed edge' : 'trim edge';
  for (const p of frames.filter((q) => q.frame.type === 'rect' && q.frame.fill && upright(q))) {
    const e = expectedPlates(inkOf(p.frame.fill!));
    const later = frames.filter((q) => q.index > p.index);
    const f = p.frame;
    const sides: { side: Side; reaches: boolean; room: number; span: [number, number] }[] = [
      { side: 'left', reaches: f.x <= -page.bleed.left + 0.01, room: boxes.trim.x - page.bleed.left, span: [f.y, f.y + f.h] },
      { side: 'right', reaches: f.x + f.w >= page.width + page.bleed.right - 0.01, room: boxes.sheet.width - boxes.trim.x - page.width - page.bleed.right, span: [f.y, f.y + f.h] },
      { side: 'top', reaches: f.y <= -page.bleed.top + 0.01, room: boxes.trim.y - page.bleed.top, span: [f.x, f.x + f.w] },
      { side: 'bottom', reaches: f.y + f.h >= page.height + page.bleed.bottom - 0.01, room: boxes.sheet.height - boxes.trim.y - page.height - page.bleed.bottom, span: [f.x, f.x + f.w] },
    ];
    for (const { side, reaches, room, span } of sides) {
      if (!reaches) continue;
      // away from the marks, which sit on the trim lines (0 and the page size) and at the middle of each side: the first of a
      // few positions along the side that lies inside the art with 2 pt to spare
      const length = side === 'left' || side === 'right' ? page.height : page.width;
      const lo = [30, 60, length / 2 - 50, length / 2 + 30, length - 70, length - 44].find((a) => a >= span[0] + 2 && a + 16 <= span[1] - 2);
      if (lo === undefined) continue;
      const inside = band(side, -5, -1, lo);
      if (insideRect(visible, inside) && !later.some((l) => intersects(l.box, inside))) {
        const m = region(inside);
        check('geometry', `${label(p)}: ink reaches the ${where} on the ${side} side`, describePlates(e), describeMeasure(m), matches(m, e));
      }
      if (room >= 6) {
        const m = region(band(side, 1, 5, lo));
        check('geometry', `${label(p)}: no ink beyond the ${where} on the ${side} side`, 'all plates 0', describeMeasure(m, 'max'), Math.max(m.max.C, m.max.M, m.max.Y, m.max.K, ...Object.values(m.spots).map((v) => v.max)) === 0);
      }
    }
  }

  // ---- photos: converted to CMYK, and close to what Ghostscript makes of the original through the same profile
  const photos = frames.filter((q) => q.frame.type === 'image' && (q.frame as Extract<Frame, { type: 'image' }>).assetId && upright(q) && !frames.some((l) => l.index > q.index && intersects(l.box, q.box)));
  if (photos.length > 0 && (input.photoMode ?? 'cmyk') === 'cmyk') {
    let reference: Separations | null = null;
    if (input.photoReference) {
      reference = await separate(input.photoReference.chromiumPdfPath, path.join(input.workDir, 'sep-photo-reference'), dpi, input.photoReference.outputProfilePath);
    }
    for (const p of photos) {
      const r = shrink(p.box, 0.95);
      const m = region(r);
      check('photo', `${label(p)}: carries ink on all four process plates`, '> 3% each', describeMeasure(m), m.mean.C > 3 && m.mean.M > 3 && m.mean.Y > 3 && m.mean.K > 3);
      if (reference) {
        const x = measureRegion(reference, px(r));
        const d = (['C', 'M', 'Y', 'K'] as const).map((k) => m.mean[k] - x.mean[k]);
        check('photo', `${label(p)}: sharp's CMYK conversion is within 6 points per plate of Ghostscript's through the same profile`, '|diff| <= 6', d.map(f1).join(' / '), d.every((v) => Math.abs(v) <= 6));
      }
    }
  }

  // ---- marks
  const pdfTrim: [number, number, number, number] = [boxes.trim.x, boxes.sheet.height - boxes.trim.y - boxes.trim.height, boxes.trim.x + boxes.trim.width, boxes.sheet.height - boxes.trim.y];
  if (options.marks) {
    const layout = marksLayout({ trim: pdfTrim, bleed: page.bleed });
    const [from, to, ypdf] = layout.horizontal[0]!; // the horizontal tick left of the top trim edge, in PDF coordinates (origin bottom-left)
    const tick: PtRect = { x0: from + 2, y0: boxes.sheet.height - ypdf - 1.5, x1: to - 2, y1: boxes.sheet.height - ypdf + 1.5 }; // the tick is 0.25 pt wide: look 1.5 pt around it
    const m = region(tick);
    const spotMax = Object.values(m.spots).map((v) => v.max);
    check('marks', 'a crop mark prints on every plate (/Separation /All), spot plates included', 'all plates >= 90', describeMeasure(m, 'max'), m.max.C >= 90 && m.max.M >= 90 && m.max.Y >= 90 && m.max.K >= 90 && spotMax.every((v) => v >= 90));
    const [tx, ty] = layout.targets[1]!; // the target above the page
    const target = region({ x0: tx - 9, y0: boxes.sheet.height - ty - 9, x1: tx + 9, y1: boxes.sheet.height - ty + 9 });
    check('marks', 'a registration target is present (top)', 'K max >= 90', `K max ${f1(target.max.K)}`, target.max.K >= 90);
    const gap = region({ x0: from + 2, y0: boxes.sheet.height - ypdf + 4, x1: to - 2, y1: boxes.sheet.height - ypdf + 14 });
    check('marks', 'the slug between marks is empty', 'all plates 0', describeMeasure(gap, 'max'), Math.max(gap.max.C, gap.max.M, gap.max.Y, gap.max.K, ...Object.values(gap.spots).map((v) => v.max)) === 0);
  }
  return checks;
}

const x_overprint = (paint: Paint) => paint.overprint;

type PlateName = 'C' | 'M' | 'Y' | 'K' | string;
function dominantPlate(p: PlateValues): PlateName | null {
  const entries: [PlateName, number][] = [['C', p.C], ['M', p.M], ['Y', p.Y], ['K', p.K], ...Object.entries(p.spots)];
  const best = entries.sort((a, b) => b[1] - a[1])[0];
  return best && best[1] > 0 ? best[0] : null;
}
/** The plate that identifies a glyph interior: the text's strongest plate, when it is strong enough to tell from an edge. */
function driverPlate(p: PlateValues): PlateName | null {
  const d = dominantPlate(p);
  return d && plateValue(p, d) >= 10 ? d : null;
}
function plateValue(p: PlateValues, name: PlateName): number {
  return name === 'C' ? p.C : name === 'M' ? p.M : name === 'Y' ? p.Y : name === 'K' ? p.K : (p.spots[name] ?? 0);
}
function plateStat(m: Measure, name: PlateName, key: 'min' | 'max' | 'mean'): number {
  return name === 'C' || name === 'M' || name === 'Y' || name === 'K' ? m[key][name] : (m.spots[name]?.[key] ?? 0);
}
function plateAt(seps: Separations, name: PlateName, i: number): number {
  const plate = name === 'C' ? seps.C : name === 'M' ? seps.M : name === 'Y' ? seps.Y : name === 'K' ? seps.K : seps.spots[name];
  return plate ? plate.ink[i]! : 0;
}

// ----------------------------------------------------------------------------------------------------- structure, RGB

const num = (o: unknown) => (o as PDFNumber).asNumber();

async function structureChecks(pdfPath: string, boxes: ReturnType<typeof pageBoxes>, options: ExportOptions): Promise<Check[]> {
  const checks: Check[] = [];
  const check = (group: string, name: string, expected: string, measured: string, pass: boolean) => checks.push({ group, name, expected, measured, pass });

  const q = spawnSync('qpdf', ['--check', pdfPath], { encoding: 'utf8' });
  const clean = q.status === 0 && /No syntax or stream encoding errors/.test(q.stdout);
  check('structure', 'qpdf --check', 'no syntax or stream errors', clean ? 'clean' : (q.stdout + q.stderr).slice(0, 160), clean);

  const bytes = fs.readFileSync(pdfPath);
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const ctx = doc.context;
  const page = doc.getPage(0);
  const box = (name: string): number[] => (page.node.lookup(PDFName.of(name), PDFArray) as PDFArray).asArray().map(num);
  const { sheet, trim, bleed } = boxes;
  const tx0 = trim.x;
  const tx1 = trim.x + trim.width;
  const ty1 = sheet.height - trim.y;
  const ty0 = ty1 - trim.height;
  const expectBox = (name: string, e: number[]) => {
    const m = box(name);
    check('structure', `${name} (pt)`, e.join(' '), m.join(' '), e.every((v, i) => Math.abs(m[i]! - v) <= 0.001));
  };
  expectBox('MediaBox', [0, 0, sheet.width, sheet.height]);
  expectBox('TrimBox', [tx0, ty0, tx1, ty1]);
  const trimBox = box('TrimBox');
  check('structure', 'TrimBox is exactly the page size', `${trim.width} x ${trim.height}`, `${trimBox[2]! - trimBox[0]!} x ${trimBox[3]! - trimBox[1]!}`, Math.abs(trimBox[2]! - trimBox[0]! - trim.width) < 1e-6 && Math.abs(trimBox[3]! - trimBox[1]! - trim.height) < 1e-6);
  if (options.bleed) expectBox('BleedBox', [tx0 - bleed.left, ty0 - bleed.bottom, tx1 + bleed.right, ty1 + bleed.top]);
  else {
    expectBox('BleedBox', [tx0, ty0, tx1, ty1]);
    check('structure', 'with bleed off the BleedBox equals the TrimBox', box('TrimBox').join(' '), box('BleedBox').join(' '), box('TrimBox').join(' ') === box('BleedBox').join(' '));
  }
  const media = box('MediaBox');
  const bb = box('BleedBox');
  check('structure', 'boxes nested: Trim within Bleed within Media', 'true', String(tx0 >= bb[0]! && bb[0]! >= media[0]! && bb[2]! <= media[2]! && bb[3]! <= media[3]!), tx0 >= bb[0]! && bb[0]! >= media[0]! && bb[2]! <= media[2]! && bb[3]! <= media[3]!);

  // PDF/X-4 plumbing
  const head = bytes.subarray(0, 8).toString('latin1');
  check('pdfx', 'header version', '%PDF-1.6', head, head === '%PDF-1.6');
  const info = ctx.lookup(ctx.trailerInfo.Info) as PDFDict;
  const gts = info.get(PDFName.of('GTS_PDFXVersion'))?.toString();
  check('pdfx', 'Info /GTS_PDFXVersion', '(PDF/X-4)', String(gts), gts === '(PDF/X-4)');
  const trapped = info.get(PDFName.of('Trapped'))?.toString();
  check('pdfx', 'Info /Trapped', '/False', String(trapped), trapped === '/False');
  const md = ctx.lookup(doc.catalog.get(PDFName.of('Metadata'))) as PDFRawStream | undefined;
  const xmp = md ? Buffer.from(md.contents).toString('utf8') : '';
  check('pdfx', 'XMP pdfxid:GTS_PDFXVersion', 'PDF/X-4', xmp.match(/<pdfxid:GTS_PDFXVersion>(.*?)</)?.[1] ?? 'missing', /<pdfxid:GTS_PDFXVersion>PDF\/X-4</.test(xmp));
  const ids = ctx.trailerInfo.ID;
  check('pdfx', 'trailer /ID (document ID)', '2 strings', ids instanceof PDFArray ? `${ids.size()} strings` : 'missing', ids instanceof PDFArray && ids.size() === 2);
  const intents = ctx.lookup(doc.catalog.get(PDFName.of('OutputIntents'))) as PDFArray | undefined;
  const intent = intents ? (ctx.lookup(intents.get(0)) as PDFDict) : undefined;
  const profile = intent ? (ctx.lookup(intent.get(PDFName.of('DestOutputProfile'))) as PDFRawStream | undefined) : undefined;
  const n = profile ? num(ctx.lookup(profile.dict.get(PDFName.of('N')))) : 0;
  check('pdfx', 'OutputIntent /S /GTS_PDFX with an embedded CMYK profile', 'GTS_PDFX, N=4', `${intent?.get(PDFName.of('S'))?.toString()}, N=${n}`, intent?.get(PDFName.of('S'))?.toString() === '/GTS_PDFX' && n === 4);
  check('pdfx', 'not encrypted', 'false', String(!!ctx.trailerInfo.Encrypt), !ctx.trailerInfo.Encrypt);

  // marks: /Separation /All exists when marks are on, and not otherwise
  let allSeparations = 0;
  for (const [, obj] of ctx.enumerateIndirectObjects()) {
    if (obj instanceof PDFArray && obj.size() >= 2 && obj.get(0)?.toString() === '/Separation' && obj.get(1)?.toString() === '/All') allSeparations++;
  }
  check('marks', options.marks ? 'registration color (/Separation /All) is used for the marks' : 'no /Separation /All marks with marks off', options.marks ? '>= 1' : '0', String(allSeparations), options.marks ? allSeparations >= 1 : allSeparations === 0);

  // fonts: all embedded
  const pf = spawnSync('pdffonts', [pdfPath], { encoding: 'utf8' }).stdout;
  const rows = pf.split('\n').slice(2).filter((l) => l.trim()).map((l) => /\s(yes|no)\s+(yes|no)\s+(yes|no)\s+\d+\s+\d+\s*$/.exec(l)?.[1] ?? 'no');
  check('fonts', 'all fonts embedded', `${rows.length}/${rows.length}`, `${rows.filter((r) => r === 'yes').length}/${rows.length}`, rows.every((r) => r === 'yes'));
  return checks;
}

async function rgbChecks(pdfPath: string, photoMode: 'cmyk' | 'rgb-icc'): Promise<Check[]> {
  const { left, info } = await scanRgb(pdfPath);
  const vector = left.filter((l) => /vector|cs \/DeviceRGB/.test(l.what));
  const other = left.filter((l) => !/vector|cs \/DeviceRGB/.test(l.what) && !(photoMode === 'rgb-icc' && /^image .* in ICCBased\(N=3\)$/.test(l.what)));
  return [
    { group: 'rgb', name: 'no DeviceRGB vector color (rg, RG, cs /DeviceRGB)', expected: '0', measured: `${vector.length} of ${info.streamsScanned} streams scanned${vector.length ? `: ${vector.slice(0, 3).map((l) => `${l.where} ${l.what}`).join('; ')}` : ''}`, pass: vector.length === 0 },
    { group: 'rgb', name: 'no RGB image, shading, group or color-space resource' + (photoMode === 'rgb-icc' ? ' (ICC-tagged RGB images allowed)' : ''), expected: '0', measured: `${other.length}${other.length ? `: ${other.slice(0, 3).map((l) => `${l.where} ${l.what}`).join('; ')}` : ''}`, pass: other.length === 0 },
  ];
}

export function formatChecks(checks: readonly Check[]): string {
  let group = '';
  const lines: string[] = [];
  for (const c of checks) {
    if (c.group !== group) {
      group = c.group;
      lines.push(`  -- ${group}`);
    }
    lines.push(`  [${c.pass ? 'PASS' : 'FAIL'}] ${c.name}\n         expected ${c.expected}; measured ${c.measured}`);
  }
  return lines.join('\n');
}
