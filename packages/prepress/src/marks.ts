// Crop marks and registration targets, drawn in the registration colour (/Separation /All), so they print on every plate.
import { MARK_GAP, MARK_LENGTH, MARK_WEIGHT, TARGET_ARM, TARGET_OFFSET, TARGET_RADIUS } from './geometry.ts';
import { fmt } from './paint.ts';

/** Trim box in PDF coordinates (origin bottom-left) and the bleed beyond each trim edge, all in points. */
export interface MarkGeometry {
  trim: [x0: number, y0: number, x1: number, y1: number];
  bleed: { top: number; right: number; bottom: number; left: number };
}

export function marksStream(g: MarkGeometry, csName: string): string {
  const [x0, y0, x1, y1] = g.trim;
  const L: string[] = [];
  const line = (ax: number, ay: number, bx: number, by: number) => L.push(`${fmt(ax)} ${fmt(ay)} m ${fmt(bx)} ${fmt(by)} l S`);
  L.push('q', `/${csName} CS 1 SCN`, `${fmt(MARK_WEIGHT)} w`);
  // crop marks: at each corner one horizontal and one vertical tick, starting just outside the bleed
  const corners: [cx: number, sx: -1 | 1, hBleed: number, cy: number, sy: -1 | 1, vBleed: number][] = [
    [x0, -1, g.bleed.left, y0, -1, g.bleed.bottom],
    [x0, -1, g.bleed.left, y1, 1, g.bleed.top],
    [x1, 1, g.bleed.right, y0, -1, g.bleed.bottom],
    [x1, 1, g.bleed.right, y1, 1, g.bleed.top],
  ];
  for (const [cx, sx, hBleed, cy, sy, vBleed] of corners) {
    line(cx + sx * (hBleed + MARK_GAP), cy, cx + sx * (hBleed + MARK_GAP + MARK_LENGTH), cy); // horizontal tick
    line(cx, cy + sy * (vBleed + MARK_GAP), cx, cy + sy * (vBleed + MARK_GAP + MARK_LENGTH)); // vertical tick
  }
  // registration targets centred on each side
  const target = (cx: number, cy: number, r = TARGET_RADIUS, arm = TARGET_ARM) => {
    const k = 0.5523 * r; // circle via 4 Beziers
    L.push(`${fmt(cx + r)} ${fmt(cy)} m`);
    L.push(`${fmt(cx + r)} ${fmt(cy + k)} ${fmt(cx + k)} ${fmt(cy + r)} ${fmt(cx)} ${fmt(cy + r)} c`);
    L.push(`${fmt(cx - k)} ${fmt(cy + r)} ${fmt(cx - r)} ${fmt(cy + k)} ${fmt(cx - r)} ${fmt(cy)} c`);
    L.push(`${fmt(cx - r)} ${fmt(cy - k)} ${fmt(cx - k)} ${fmt(cy - r)} ${fmt(cx)} ${fmt(cy - r)} c`);
    L.push(`${fmt(cx + k)} ${fmt(cy - r)} ${fmt(cx + r)} ${fmt(cy - k)} ${fmt(cx + r)} ${fmt(cy)} c S`);
    line(cx - arm, cy, cx + arm, cy);
    line(cx, cy - arm, cx, cy + arm);
  };
  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2;
  target(mx, y0 - g.bleed.bottom - TARGET_OFFSET);
  target(mx, y1 + g.bleed.top + TARGET_OFFSET);
  target(x0 - g.bleed.left - TARGET_OFFSET, my);
  target(x1 + g.bleed.right + TARGET_OFFSET, my);
  L.push('Q');
  return L.join('\n') + '\n';
}

/** Where the crop marks and targets sit, in PDF coordinates, so tests can look for ink there (and nowhere else). */
export function marksLayout(g: MarkGeometry) {
  const [x0, y0, x1, y1] = g.trim;
  return {
    /** The four horizontal ticks, as [xFrom, xTo, y], and the four vertical ticks as [x, yFrom, yTo]. */
    horizontal: [
      [x0 - g.bleed.left - MARK_GAP - MARK_LENGTH, x0 - g.bleed.left - MARK_GAP, y0],
      [x0 - g.bleed.left - MARK_GAP - MARK_LENGTH, x0 - g.bleed.left - MARK_GAP, y1],
      [x1 + g.bleed.right + MARK_GAP, x1 + g.bleed.right + MARK_GAP + MARK_LENGTH, y0],
      [x1 + g.bleed.right + MARK_GAP, x1 + g.bleed.right + MARK_GAP + MARK_LENGTH, y1],
    ] as [number, number, number][],
    targets: [
      [(x0 + x1) / 2, y0 - g.bleed.bottom - TARGET_OFFSET],
      [(x0 + x1) / 2, y1 + g.bleed.top + TARGET_OFFSET],
      [x0 - g.bleed.left - TARGET_OFFSET, (y0 + y1) / 2],
      [x1 + g.bleed.right + TARGET_OFFSET, (y0 + y1) / 2],
    ] as [number, number][],
  };
}
