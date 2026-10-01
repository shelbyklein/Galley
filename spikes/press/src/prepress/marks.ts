// Crop marks and registration targets, drawn in the registration colour (/Separation /All).
import { fmt } from './paint.ts';

export interface Geometry { pageW: number; pageH: number; trim: [number, number, number, number]; bleed: number } // pt; trim = [x0,y0,x1,y1] (PDF coords, origin bottom-left)

export function marksStream(g: Geometry, csName: string, offset = 12, len = 18, weight = 0.25): string {
  const [x0, y0, x1, y1] = g.trim;
  const L: string[] = [];
  const line = (ax: number, ay: number, bx: number, by: number) => L.push(`${fmt(ax)} ${fmt(ay)} m ${fmt(bx)} ${fmt(by)} l S`);
  L.push('q', `/${csName} CS 1 SCN`, `${fmt(weight)} w`);
  // crop marks: for each corner, one horizontal and one vertical tick, starting `offset` away from the trim edge (>= bleed)
  for (const [cx, sx] of [[x0, -1], [x1, 1]] as const) {
    for (const [cy, sy] of [[y0, -1], [y1, 1]] as const) {
      line(cx + sx * offset, cy, cx + sx * (offset + len), cy); // horizontal tick
      line(cx, cy + sy * offset, cx, cy + sy * (offset + len)); // vertical tick
    }
  }
  // registration targets centred on each side, inside the slug
  const target = (cx: number, cy: number, r = 5, arm = 9) => {
    const k = 0.5523 * r; // circle via 4 Beziers
    L.push(`${fmt(cx + r)} ${fmt(cy)} m`);
    L.push(`${fmt(cx + r)} ${fmt(cy + k)} ${fmt(cx + k)} ${fmt(cy + r)} ${fmt(cx)} ${fmt(cy + r)} c`);
    L.push(`${fmt(cx - k)} ${fmt(cy + r)} ${fmt(cx - r)} ${fmt(cy + k)} ${fmt(cx - r)} ${fmt(cy)} c`);
    L.push(`${fmt(cx - r)} ${fmt(cy - k)} ${fmt(cx - k)} ${fmt(cy - r)} ${fmt(cx)} ${fmt(cy - r)} c`);
    L.push(`${fmt(cx + k)} ${fmt(cy - r)} ${fmt(cx + r)} ${fmt(cy - k)} ${fmt(cx + r)} ${fmt(cy)} c S`);
    line(cx - arm, cy, cx + arm, cy);
    line(cx, cy - arm, cx, cy + arm);
  };
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  const slug = 24; // centre of the target, from the trim edge
  target(mx, y0 - slug); target(mx, y1 + slug); target(x0 - slug, my); target(x1 + slug, my);
  L.push('Q');
  return L.join('\n') + '\n';
}
