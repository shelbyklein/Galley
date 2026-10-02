// Milestone 1: measure the exported poster PDF. Used by the milestone spec (apps/desktop/e2e/milestone), which cannot import
// the ESM workspace packages itself (same arrangement as scripts/golden/check-pdf.ts, whose measurement functions this reuses):
//   tsx scripts/milestone1/check-poster.ts <pdf> <package dir> <work dir> [<plate image dir>]
// It runs the whole golden suite (`runGoldenChecks`: boxes, PDF/X-4 plumbing, qpdf, leftover RGB, every flat patch, every
// text frame, bleed, photo, marks) and then measures the poster's own named things from the Ghostscript `tiffsep` plates:
// every flat swatch fill, the spot plate on its own, the body text. Prints one JSON line `{"checks":[...],"measurements":{...}}`
// and exits 0 when every check passed, 1 otherwise, 2 on an error.
import { isLayerVisible, paintOrder, parseDocument, resolveInk, type Frame, type GalleyDocument } from '@galley/model';
import { exportPage, pageBoxes } from '@galley/prepress';
import { expectedPlates, measureRegion, runGoldenChecks, separate, type Check } from '@galley/prepress/verify';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { readPackage } from '../golden/lib/app';

/** Points from the top-left of the page's trim box. */
interface PtRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
type Leaf = Exclude<Frame, { type: 'group' }>;
const rectOf = (f: Leaf): PtRect => ({ x0: f.x, y0: f.y, x1: f.x + f.w, y1: f.y + f.h });
const intersects = (a: PtRect, b: PtRect) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const grow = (r: PtRect, d: number): PtRect => ({ x0: r.x0 - d, y0: r.y0 - d, x1: r.x1 + d, y1: r.y1 + d });
const inside = (outer: PtRect, r: PtRect) => r.x0 >= outer.x0 && r.y0 >= outer.y0 && r.x1 <= outer.x1 && r.y1 <= outer.y1;

/** All the plain text of a story, paragraphs joined by a newline (walks the ProseMirror JSON generically). */
function storyText(doc: GalleyDocument, storyId: string): string {
  const walk = (n: { text?: string; content?: unknown[] }): string => (typeof n.text === 'string' ? n.text : ((n.content ?? []) as { text?: string; content?: unknown[] }[]).map(walk).join(n.content && (n.content[0] as { type?: string })?.type === 'paragraph' ? '\n' : ''));
  return walk(doc.stories[storyId]!.doc as never);
}

const round1 = (n: number) => Math.round(n * 10) / 10;

async function main(): Promise<void> {
  const [pdfPath, pkgDir, workDir, plateDir] = process.argv.slice(2);
  if (!pdfPath || !pkgDir || !workDir) throw new Error('usage: check-poster <pdf> <package dir> <work dir> [<plate image dir>]');
  const doc = parseDocument(readPackage(pkgDir));
  const options = { bleed: true, marks: true };
  const pageId = doc.pageOrder[0]!;

  const checks: Check[] = await runGoldenChecks({ pdfPath, doc, options, workDir: path.join(workDir, 'golden') });

  const page = exportPage(doc.pages[pageId]!, options);
  const boxes = pageBoxes(page);
  const seps = await separate(pdfPath, path.join(workDir, 'plates'));
  const s = seps.scale;
  const measure = (r: PtRect) =>
    measureRegion(seps, { x: (boxes.trim.x + r.x0) * s, y: (boxes.trim.y + r.y0) * s, w: (r.x1 - r.x0) * s, h: (r.y1 - r.y0) * s });
  const spots = (m: ReturnType<typeof measure>, key: 'mean' | 'max') => Object.fromEntries(Object.entries(m.spots).map(([n, v]) => [n, round1(v[key])]));

  const frames = paintOrder(doc, pageId).filter((f) => isLayerVisible(doc, f.layerId));
  const visible: PtRect = { x0: -page.bleed.left, y0: -page.bleed.top, x1: page.width + page.bleed.right, y1: page.height + page.bleed.bottom };

  // ---- every flat swatch fill: the window of the shape nearest its middle that nothing paints over
  const patches: unknown[] = [];
  for (const [index, f] of frames.entries()) {
    if ((f.type !== 'rect' && f.type !== 'ellipse') || !f.fill || f.rotation !== 0) continue;
    const ink = resolveInk(doc, f.fill);
    const later = frames.slice(index + 1).map(rectOf);
    const box = rectOf(f);
    const edge = (f.stroke?.weight ?? 0) + 3;
    const cx = (box.x0 + box.x1) / 2;
    const cy = (box.y0 + box.y1) / 2;
    let best: { r: PtRect; d: number } | null = null;
    for (let x = box.x0; x + 20 <= box.x1; x += 4) {
      for (let y = box.y0; y + 20 <= box.y1; y += 4) {
        const r: PtRect = { x0: x, y0: y, x1: x + 20, y1: y + 20 };
        const fitsShape =
          f.type === 'rect'
            ? inside({ x0: box.x0 + edge, y0: box.y0 + edge, x1: box.x1 - edge, y1: box.y1 - edge }, r)
            : [[r.x0, r.y0], [r.x1, r.y0], [r.x0, r.y1], [r.x1, r.y1]].every(([px, py]) => ((px! - cx) / ((box.x1 - box.x0) / 2 - edge)) ** 2 + ((py! - cy) / ((box.y1 - box.y0) / 2 - edge)) ** 2 <= 1);
        if (!fitsShape || !inside(visible, r) || later.some((l) => intersects(grow(l, 2), r))) continue;
        const d = Math.hypot((r.x0 + r.x1) / 2 - cx, (r.y0 + r.y1) / 2 - cy);
        if (!best || d < best.d) best = { r, d };
      }
    }
    if (!best) continue;
    const m = measure(best.r);
    const expected = expectedPlates(ink);
    const within = (v: number, e: number) => Math.abs(v - e) <= 2;
    const pass =
      within(m.mean.C, expected.C) && within(m.mean.M, expected.M) && within(m.mean.Y, expected.Y) && within(m.mean.K, expected.K) && [...new Set([...Object.keys(m.spots), ...Object.keys(expected.spots)])].every((n) => within(m.spots[n]?.mean ?? 0, expected.spots[n] ?? 0));
    patches.push({
      frame: f.name || f.id,
      swatch: ink.name,
      model: ink.model,
      expected: { C: expected.C, M: expected.M, Y: expected.Y, K: expected.K, spots: expected.spots },
      measured: { C: round1(m.mean.C), M: round1(m.mean.M), Y: round1(m.mean.Y), K: round1(m.mean.K), spots: spots(m, 'mean') },
      region: best.r,
      pass,
    });
  }

  // ---- text: every text frame that sits on bare paper must print on the Black plate only
  const texts: unknown[] = [];
  for (const [index, f] of frames.entries()) {
    if (f.type !== 'text' || f.rotation !== 0) continue;
    const text = storyText(doc, f.storyId).replace(/\n/g, ' / ');
    if (text.trim() === '') continue;
    const box = rectOf(f);
    const onPaper = !frames.some((o, i) => i !== index && (o.type === 'rect' || o.type === 'ellipse' || o.type === 'image') && intersects(rectOf(o), box));
    if (!onPaper || !inside(visible, box)) continue;
    const m = measure(box);
    texts.push({
      frame: f.name || f.id,
      text: text.slice(0, 40),
      max: { C: round1(m.max.C), M: round1(m.max.M), Y: round1(m.max.Y), K: round1(m.max.K), spots: spots(m, 'max') },
      pass: m.max.C === 0 && m.max.M === 0 && m.max.Y === 0 && Object.values(m.spots).every((v) => v.max === 0) && m.max.K >= 99,
    });
  }

  // ---- the plates: one per spot color, named, and an image of each so a person can see the spot is alone on its plate
  const plateNames = Object.keys(seps.spots).sort();
  if (plateDir) {
    fs.mkdirSync(plateDir, { recursive: true });
    for (const [name, plate] of Object.entries(seps.spots)) {
      const bytes = Buffer.alloc(plate.w * plate.h);
      for (let i = 0; i < bytes.length; i++) bytes[i] = Math.round(255 - plate.ink[i]! * 2.55);
      await sharp(bytes, { raw: { width: plate.w, height: plate.h, channels: 1 } })
        .resize({ width: 864 })
        .png()
        .toFile(path.join(plateDir, `plate-${name.replace(/[^A-Za-z0-9]+/g, '-')}.png`));
    }
  }

  const bad = [...patches, ...texts].some((x) => !(x as { pass: boolean }).pass);
  console.log(JSON.stringify({ checks, measurements: { plateNames, patches, texts, boxes: { sheet: boxes.sheet, trim: boxes.trim } } }));
  process.exit(checks.every((c) => c.pass) && !bad ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
