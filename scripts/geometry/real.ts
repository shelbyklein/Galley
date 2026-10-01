// The geometry check on the real renderer: export the fractional-position document through the app's own pipeline and
// measure Chromium's PDF (and the press PDF after prepress) against the model's numbers.
import { measurePdfGeometry, type Box, type PdfGeometry } from '@galley/prepress/verify';
import { serializeDocument } from '@galley/model';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { exportToFile, FIXTURES_DIR, launchGalley } from '../golden/lib/app';
import { GEO_ORIGIN, IMAGES, SHAPES, TEXTS, buildGeometryDoc } from './doc';
import type { Row } from './lab';

const TOLERANCE = 0.05;
const f3 = (n: number) => n.toFixed(3);
const edge = (b: Box, e: Box) => Math.max(Math.abs(b.x0 - e.x0), Math.abs(b.y0 - e.y0), Math.abs(b.x1 - e.x1), Math.abs(b.y1 - e.y1));

/** The fills of the shapes, in paint order (the document paints them in `SHAPES` order, then text, then images). */
function checkShapes(g: PdfGeometry, label: string): Row[] {
  const rows: Row[] = [];
  const fills = g.paths.filter((p) => p.kind === 'fill' && p.box.x1 - p.box.x0 < 590);
  const strokes = g.paths.filter((p) => p.kind === 'stroke' && p.box.x1 - p.box.x0 < 590);
  let worst = 0;
  let worstId = '';
  let fillIndex = 0;
  for (const s of SHAPES) {
    if (s.type === 'line') continue;
    const expected: Box = { x0: GEO_ORIGIN.x + s.x, y0: GEO_ORIGIN.y + s.y, x1: GEO_ORIGIN.x + s.x + s.w, y1: GEO_ORIGIN.y + s.y + s.h };
    const got = fills[fillIndex++];
    if (!got) {
      rows.push({ section: label, item: `shape ${s.id}`, measured: 'not found in the PDF', limit: `<= ${TOLERANCE} pt`, pass: false });
      continue;
    }
    const e = edge(got.box, expected);
    if (e > worst) [worst, worstId] = [e, s.id];
  }
  rows.push({ section: label, item: `SVG shape edges (${fillIndex} fills: rects, ellipse, 0.25 pt-tall rect)`, measured: `up to ${f3(worst)} pt${worstId ? ` (${worstId})` : ''}`, limit: `<= ${TOLERANCE} pt`, pass: worst <= TOLERANCE });

  const line = SHAPES.find((s) => s.type === 'line')!;
  const lineExpected: Box = { x0: GEO_ORIGIN.x + line.x, y0: GEO_ORIGIN.y + line.y, x1: GEO_ORIGIN.x + line.x + line.w, y1: GEO_ORIGIN.y + line.y };
  const lineGot = strokes.find((p) => Math.abs(p.box.x1 - p.box.x0 - line.w) < 1 && p.box.y1 - p.box.y0 < 0.01);
  rows.push({
    section: label,
    item: 'line end points and weight (0.25 pt)',
    measured: lineGot ? `ends up to ${f3(edge(lineGot.box, lineExpected))} pt, weight ${f3(lineGot.lineWidth)} pt` : 'not found',
    limit: `<= ${TOLERANCE} pt, weight 0.25 +/- 0.005`,
    pass: !!lineGot && edge(lineGot.box, lineExpected) <= TOLERANCE && Math.abs(lineGot.lineWidth - 0.25) <= 0.005,
  });
  return rows;
}

function checkText(g: PdfGeometry, label: string): { rows: Row[]; baseline: number } {
  const rows: Row[] = [];
  // one text block per frame, in paint order; the first glyph run of each block is the first baseline's origin
  const firsts = TEXTS.map((_, i) => g.texts.find((t) => t.block === i));
  const ref = firsts[0]!; // the frame on whole CSS pixels: the baseline offset inside a frame, measured, not assumed
  const baseline = ref.y - (GEO_ORIGIN.y + TEXTS[0]!.y);
  rows.push({ section: label, item: 'baseline offset in the reference frame (Inter 12 pt on 18 pt, frame on whole px)', measured: `${f3(baseline)} pt`, limit: '13.5 pt (18 px)', pass: Math.abs(baseline - 13.5) < 0.01 });

  let worstX = 0;
  let worstY = 0;
  const plain = TEXTS.filter((t) => t.rotation === 0 && t.leading === 18); // includes the frame with a 3.6 pt inset
  for (const t of plain) {
    const got = firsts[TEXTS.indexOf(t)];
    if (!got) {
      rows.push({ section: label, item: `text frame ${t.id}`, measured: 'not found in the PDF', limit: `<= ${TOLERANCE} pt`, pass: false });
      continue;
    }
    worstX = Math.max(worstX, Math.abs(got.x - (GEO_ORIGIN.x + t.x + t.inset)));
    worstY = Math.max(worstY, Math.abs(got.y - (GEO_ORIGIN.y + t.y + t.inset + baseline)));
  }
  rows.push({ section: label, item: `first-baseline origin of ${plain.length} text frames at fractional x, y, w, h`, measured: `x up to ${f3(worstX)} pt, y up to ${f3(worstY)} pt`, limit: `<= ${TOLERANCE} pt`, pass: worstX <= TOLERANCE && worstY <= TOLERANCE });

  // rotated frame: rotate the local baseline origin about the frame center
  const rot = TEXTS.find((t) => t.rotation !== 0)!;
  const got = firsts[TEXTS.indexOf(rot)]!;
  const cx = GEO_ORIGIN.x + rot.x + rot.w / 2;
  const cy = GEO_ORIGIN.y + rot.y + rot.h / 2;
  const dx = GEO_ORIGIN.x + rot.x - cx;
  const dy = GEO_ORIGIN.y + rot.y + baseline - cy;
  const a = (rot.rotation * Math.PI) / 180;
  const ex = cx + dx * Math.cos(a) - dy * Math.sin(a);
  const ey = cy + dx * Math.sin(a) + dy * Math.cos(a);
  const err = Math.hypot(got.x - ex, got.y - ey);
  rows.push({ section: label, item: `rotated frame (${rot.rotation} degrees about its center): first-baseline origin`, measured: `${f3(err)} pt off`, limit: `<= ${TOLERANCE} pt`, pass: err <= TOLERANCE });

  // documented, not asserted: how Chromium places a baseline when the offset inside the frame is not whole pixels
  for (const t of TEXTS.filter((x) => x.leading !== 18)) {
    const r = firsts[TEXTS.indexOf(t)]!;
    const ideal = t.inset + baseline + (t.leading - 18) / 2; // the line box is centred on the leading
    rows.push({
      section: label,
      item: `(informational) ${t.id}: ${t.note}`,
      measured: `baseline ${f3(r.y - (GEO_ORIGIN.y + t.y))} pt below the frame top (exact would be ${f3(ideal)}), x ${f3(r.x - (GEO_ORIGIN.x + t.x))} pt in`,
      limit: 'documented in GEOMETRY.md',
      pass: null,
    });
  }
  return { rows, baseline };
}

function checkImages(g: PdfGeometry, label: string): Row[] {
  const i = IMAGES[0]!;
  const expected: Box = {
    x0: GEO_ORIGIN.x + i.x + i.content.x,
    y0: GEO_ORIGIN.y + i.y + i.content.y,
    x1: GEO_ORIGIN.x + i.x + i.content.x + i.content.w,
    y1: GEO_ORIGIN.y + i.y + i.content.y + i.content.h,
  };
  const got = g.images[0];
  const rows: Row[] = [{ section: label, item: 'image content rectangle at fractional position and size', measured: got ? `edges up to ${f3(edge(got, expected))} pt` : 'not found', limit: `<= ${TOLERANCE} pt`, pass: !!got && edge(got, expected) <= TOLERANCE }];
  // the clip of the image frame: the frame box itself
  const frameBox: Box = { x0: GEO_ORIGIN.x + i.x, y0: GEO_ORIGIN.y + i.y, x1: GEO_ORIGIN.x + i.x + i.w, y1: GEO_ORIGIN.y + i.y + i.h };
  const clip = g.clips.find((c) => Math.abs(c.x0 - frameBox.x0) < 1 && Math.abs(c.y0 - frameBox.y0) < 1 && c.x1 - c.x0 < 300);
  rows.push({ section: label, item: 'image frame clip', measured: clip ? `edges up to ${f3(edge(clip, frameBox))} pt` : 'not found', limit: '<= 0.02 pt', pass: !!clip && edge(clip, frameBox) <= 0.02 });
  return rows;
}

export async function runReal(): Promise<Row[]> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'galley-geometry-real-'));
  const running = await launchGalley({ open: path.join(FIXTURES_DIR, 'poster-basic.galley') });
  try {
    const doc = buildGeometryDoc();
    const files = serializeDocument(doc);
    const pdf = path.join(dir, 'geometry.pdf');
    const raw = path.join(dir, 'geometry.chromium.pdf');
    // the defaults (bleed on, marks on): the sheet is trim + 36 pt, so the page origin is (36, 36). Chromium's PDF has no marks.
    await exportToFile(running, { files, options: { bleed: true, marks: true } }, pdf, raw);
    const rows: Row[] = [];
    const chromium = await measurePdfGeometry(fs.readFileSync(raw));
    rows.push(...checkShapes(chromium, 'Chromium PDF'));
    const text = checkText(chromium, 'Chromium PDF');
    rows.push(...text.rows, ...checkImages(chromium, 'Chromium PDF'));
    return rows;
  } finally {
    await running.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
