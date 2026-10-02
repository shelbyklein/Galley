// Frame geometry. Everything in pt, positioned absolutely on the page.
// Coordinates are multiples of 3pt (so whole CSS px: 0.75pt) to avoid the whole-pixel snapping noted in the press spike.

export interface FrameDef {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  cols?: number; // >1: a multi-column frame, which is just N chained slots side by side
  gutter?: number;
}

/** An object text wraps around (an image frame). Page coordinates, pt. */
export interface Obstacle {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  shape: 'rect' | 'ellipse';
  offset: number; // text offset around the object, pt
}

/** An invisible float injected at the top of a slot (both in the measurement DOM and the real frame). */
export interface WrapSpec {
  side: 'left' | 'right';
  top: number; // pt from the slot top
  width: number;
  height: number;
  shape: string; // CSS shape-outside value
}

/** One link in the thread. A 2-column frame contributes 2 slots. */
export interface Slot {
  idx: number;
  frame: string;
  col: number;
  x: number;
  y: number;
  w: number;
  h: number;
  wraps: WrapSpec[];
}

export interface PageDef {
  id: string;
  w: number;
  h: number;
  frames: FrameDef[];
  obstacles?: Obstacle[];
}

/**
 * Floats that make a slot's text wrap around obstacles. Text wraps on ONE side of the obstacle (the side facing the slot
 * edge it reaches), which is what a CSS float can express; text to the far side of an obstacle that sits in the middle of
 * a slot is not reachable (InDesign's "jump object" and wrap-both-sides need a different mechanism).
 */
export function computeWraps(slot: Omit<Slot, 'wraps'>, obstacles: Obstacle[]): WrapSpec[] {
  const out: (WrapSpec & { y0: number })[] = [];
  for (const o of obstacles) {
    const ex0 = o.x - o.offset;
    const ey0 = o.y - o.offset;
    const ex1 = o.x + o.w + o.offset;
    const ey1 = o.y + o.h + o.offset;
    const ox0 = Math.max(ex0, slot.x) - slot.x;
    const ox1 = Math.min(ex1, slot.x + slot.w) - slot.x;
    const oy0 = Math.max(ey0, slot.y) - slot.y;
    const oy1 = Math.min(ey1, slot.y + slot.h) - slot.y;
    if (ox1 <= ox0 || oy1 <= oy0) continue;
    const cx = o.x + o.w / 2;
    const side: 'left' | 'right' = ox1 >= slot.w - 1e-6 ? 'right' : ox0 <= 1e-6 ? 'left' : cx > slot.x + slot.w / 2 ? 'right' : 'left';
    const left = side === 'right' ? ox0 : 0;
    const width = side === 'right' ? slot.w - ox0 : ox1;
    let shape = 'border-box';
    if (o.shape === 'ellipse') {
      const cxRel = o.x + o.w / 2 - slot.x - left;
      const cyRel = o.y + o.h / 2 - slot.y - oy0;
      shape = `ellipse(${o.w / 2 + o.offset}pt ${o.h / 2 + o.offset}pt at ${cxRel}pt ${cyRel}pt) border-box`;
    }
    out.push({ side, top: oy0, width, height: oy1 - oy0, shape, y0: oy0 });
  }
  return out.sort((a, b) => a.y0 - b.y0).map(({ y0: _y, ...w }) => w);
}

export function expandSlots(frames: FrameDef[], obstacles: Obstacle[] = []): Slot[] {
  const out: Slot[] = [];
  for (const f of frames) {
    const cols = f.cols ?? 1;
    const gutter = f.gutter ?? 0;
    const cw = (f.w - gutter * (cols - 1)) / cols;
    for (let c = 0; c < cols; c++) {
      const base = { idx: out.length, frame: f.id, col: c, x: f.x + c * (cw + gutter), y: f.y, w: cw, h: f.h };
      out.push({ ...base, wraps: computeWraps(base, obstacles) });
    }
  }
  return out;
}

/** Letter page, a magazine-opener layout: wide short F1, narrow tall F2, medium F3, then a 2-column F4. */
const defaultPage: PageDef = {
  id: 'default',
  w: 612,
  h: 792,
  frames: [
    { id: 'F1', x: 54, y: 54, w: 504, h: 156 },
    { id: 'F2', x: 54, y: 228, w: 144, h: 288 },
    { id: 'F3', x: 216, y: 228, w: 342, h: 288 },
    { id: 'F4', x: 54, y: 534, w: 504, h: 222, cols: 2, gutter: 18 },
  ],
};

/** The default page plus an elliptical image that straddles frames 2 and 3: text wraps around it in both. */
const wrapPage: PageDef = {
  ...defaultPage,
  id: 'wrap',
  obstacles: [{ id: 'IMG', x: 141, y: 345, w: 150, h: 120, shape: 'ellipse', offset: 6 }],
};

/** The same page with just the three single-column frames (benchmark (a): "3-frame story"). */
const threePage: PageDef = {
  id: 'three',
  w: 612,
  h: 792,
  frames: [
    { id: 'F1', x: 54, y: 54, w: 504, h: 210 },
    { id: 'F2', x: 54, y: 282, w: 150, h: 456 },
    { id: 'F3', x: 222, y: 282, w: 336, h: 456 },
  ],
};

/** 20 frames of varying width on a big canvas (benchmark (b)). Not a printable page. */
function long20(): PageDef {
  const frames: FrameDef[] = [];
  const widths = [300, 372, 330, 411, 342];
  const heights = [468, 480, 456, 492];
  let y = 24;
  for (let r = 0; r < 4; r++) {
    let x = 24;
    for (let c = 0; c < 5; c++) {
      const w = widths[(c + r * 2) % widths.length];
      const h = heights[(c + r) % heights.length];
      frames.push({ id: `L${r * 5 + c + 1}`, x, y, w, h });
      x += w + 18;
    }
    y += 492 + 18;
  }
  return { id: 'long20', w: 24 + 5 * 360 + 4 * 18 + 80, h: y + 24, frames };
}

export function getPage(id: string): PageDef {
  switch (id) {
    case 'three':
      return threePage;
    case 'wrap':
      return wrapPage;
    case 'long20':
      return long20();
    default:
      return defaultPage;
  }
}
