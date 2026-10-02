import { describe, expect, it } from 'vitest';
import { measurePdfGeometry } from '../src/verify/geometry';
import { chromiumLikePdf } from './helpers';

// measurePdfGeometry on hand-written content: units are 1/300 in like Skia's, y flipped, so the numbers can be checked by hand.
describe('measurePdfGeometry', () => {
  const header = '.24 0 0 -.24 0 240 cm\n'; // page 100 x 240 pt; one unit = 0.24 pt; origin top-left
  it('reports painted rectangles, clips and strokes in points from the top-left of the MediaBox', async () => {
    const content = `${header}q 0 0 400 500 re W* n q 1 0 0 1 100 50 cm 0 0 250 125 re f Q Q q 2 w 0 0 m 100 0 l S Q`;
    const g = await measurePdfGeometry(await chromiumLikePdf(content, 100, 240));
    expect(g.mediaBox).toEqual([0, 0, 100, 240]);
    expect(g.clips).toHaveLength(1);
    expect(g.clips[0]!.x1).toBeCloseTo(96, 6); // 400 units = 96 pt
    expect(g.clips[0]!.y1).toBeCloseTo(120, 6);
    const fill = g.paths.find((p) => p.kind === 'fill')!;
    expect(fill.box.x0).toBeCloseTo(24, 6); // 100 units
    expect(fill.box.y0).toBeCloseTo(12, 6); // 50 units
    expect(fill.box.x1 - fill.box.x0).toBeCloseTo(60, 6);
    expect(fill.box.y1 - fill.box.y0).toBeCloseTo(30, 6);
    const stroke = g.paths.find((p) => p.kind === 'stroke')!;
    expect(stroke.lineWidth).toBeCloseTo(0.48, 6); // 2 units
  });

  it('finds the origin of each text run and which text block it belongs to', async () => {
    const content = `${header}q 1 0 0 1 10 20 cm BT /F1 16 Tf 1 0 0 -1 48 150 Tm <0026> Tj 20 0 Td <00a1> Tj ET Q BT /F1 8 Tf 1 0 0 -1 0 0 Tm <0026> Tj ET`;
    const g = await measurePdfGeometry(await chromiumLikePdf(content, 100, 240));
    expect(g.texts.map((t) => t.block)).toEqual([0, 0, 1]);
    // (48 + 10, 150 + 20) units -> 58 x 0.24 = 13.92 pt, 170 x 0.24 = 40.8 pt below the top
    expect(g.texts[0]!.x).toBeCloseTo(13.92, 6);
    expect(g.texts[0]!.y).toBeCloseTo(40.8, 6);
    expect(g.texts[0]!.size).toBeCloseTo(16 * 0.24, 6);
    expect(g.texts[1]!.x).toBeCloseTo(18.72, 6); // Td moved the origin 20 units sideways: (58 + 20) x 0.24
  });

  it('ignores a Do whose XObject does not exist', async () => {
    const content = `${header}q 250 0 0 -125 100 300 cm /Im1 Do Q`;
    const g = await measurePdfGeometry(await chromiumLikePdf(content, 100, 240));
    expect(g.images).toHaveLength(0); // no such XObject in the resources: nothing to report, and no crash
  });
});
