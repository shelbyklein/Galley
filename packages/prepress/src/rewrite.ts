// Content-stream colour rewriter: sentinel RGB -> DeviceCMYK / Separation, with overprint tracking.
import { parseContent, nums, type Op } from './tokenizer.ts';
import { effectiveCmyk, fmt, type Paint, type SentinelTable } from './paint.ts';

export interface RewriteStats {
  rgbOps: number;
  sentinelHits: Map<string, number>; // paint id -> count
  cmykOut: number;
  spotOut: number;
  overprintToggles: number;
  defaultBlack: number;
  defaultWhite: number;
  unmatched: string[]; // human-readable descriptions of RGB colours that were not sentinels
  unhandled: string[]; // colour ops we saw but could not rewrite (e.g. sc/scn in an ICC/Cal space)
  otherColorOps: Map<string, number>; // g, G, k, K, cs, scn(pattern)... passed through
}

export interface RewriteResult {
  out: string;
  spotsUsed: Set<string>; // spot names needing /ColorSpace resources
  gsUsed: Set<string>; // overprint ExtGState resource names needed
  stats: RewriteStats;
}

export const spotResName = (spotName: string, order: string[]) => `GalleySep${order.indexOf(spotName)}`;
export const opGsName = (stroke: boolean, fill: boolean) => `GalleyOP${stroke ? 1 : 0}${fill ? 1 : 0}`;

interface St { fillCS: string; strokeCS: string; opFill: boolean; opStroke: boolean }

export function rewriteContent(src: string, table: SentinelTable, spotOrder: string[], where: string): RewriteResult {
  const ops = parseContent(src);
  const stats: RewriteStats = {
    rgbOps: 0, sentinelHits: new Map(), cmykOut: 0, spotOut: 0, overprintToggles: 0, defaultBlack: 0, defaultWhite: 0,
    unmatched: [], unhandled: [], otherColorOps: new Map(),
  };
  const spotsUsed = new Set<string>();
  const gsUsed = new Set<string>();
  const stack: St[] = [];
  let st: St = { fillCS: 'DeviceGray', strokeCS: 'DeviceGray', opFill: false, opStroke: false };
  let out = '';
  let cursor = 0;

  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

  /** returns "/GalleyOPxx gs " when the wanted overprint state differs from the tracked one */
  const syncOverprint = (wantFill: boolean, wantStroke: boolean): string => {
    if (wantFill === st.opFill && wantStroke === st.opStroke) return '';
    st.opFill = wantFill; st.opStroke = wantStroke;
    stats.overprintToggles++;
    const name = opGsName(wantStroke, wantFill);
    gsUsed.add(name);
    return `/${name} gs\n`;
  };

  const replace = (op: Op, text: string) => {
    out += src.slice(cursor, op.start) + text;
    cursor = op.end;
  };
  const insertBefore = (op: Op, text: string) => {
    if (!text) return;
    out += src.slice(cursor, op.start) + text;
    cursor = op.start;
  };

  const paintColor = (op: Op, p: Paint, stroke: boolean) => {
    let text: string;
    if (p.model === 'cmyk') {
      text = effectiveCmyk(p).map(fmt).join(' ') + (stroke ? ' K' : ' k');
      stats.cmykOut++;
      if (stroke) st.strokeCS = 'DeviceCMYK'; else st.fillCS = 'DeviceCMYK';
    } else {
      const spot = p.name;
      spotsUsed.add(spot);
      const res = spotResName(spot, spotOrder);
      text = `/${res} ${stroke ? 'CS' : 'cs'} ${fmt(p.tint / 100)} ${stroke ? 'SCN' : 'scn'}`;
      stats.spotOut++;
      if (stroke) st.strokeCS = res; else st.fillCS = res;
    }
    const gs = syncOverprint(stroke ? st.opFill : p.overprint, stroke ? p.overprint : st.opStroke);
    stats.sentinelHits.set(p.key, (stats.sentinelHits.get(p.key) ?? 0) + 1);
    replace(op, gs + text);
  };

  const rgbColor = (op: Op, stroke: boolean, r: number, g: number, b: number) => {
    stats.rgbOps++;
    const p = table.lookup(r, g, b);
    if (p) return paintColor(op, p, stroke);
    // Not a sentinel. Pure RGB black/white are what Skia emits as default state before Do; map to K/paper.
    const eq = (a: number, v: number) => Math.abs(a - v) < 0.002;
    if (eq(r, 0) && eq(g, 0) && eq(b, 0)) {
      stats.defaultBlack++;
      if (stroke) st.strokeCS = 'DeviceCMYK'; else st.fillCS = 'DeviceCMYK';
      const gs = syncOverprint(stroke ? st.opFill : false, stroke ? false : st.opStroke);
      return replace(op, gs + `0 0 0 1 ${stroke ? 'K' : 'k'}`);
    }
    if (eq(r, 1) && eq(g, 1) && eq(b, 1)) {
      stats.defaultWhite++;
      if (stroke) st.strokeCS = 'DeviceCMYK'; else st.fillCS = 'DeviceCMYK';
      const gs = syncOverprint(stroke ? st.opFill : false, stroke ? false : st.opStroke);
      return replace(op, gs + `0 0 0 0 ${stroke ? 'K' : 'k'}`);
    }
    stats.unmatched.push(`${where}: ${fmt(r)} ${fmt(g)} ${fmt(b)} ${stroke ? 'RG' : 'rg'} @${op.start}`);
  };

  for (const op of ops) {
    const o = op.operator;
    switch (o) {
      case 'q': stack.push({ ...st }); break;
      case 'Q': if (stack.length) st = stack.pop()!; break;
      case 'rg': case 'RG': {
        const n = nums(op.operands);
        if (n.length === 3 && n.every((x) => !Number.isNaN(x))) rgbColor(op, o === 'RG', n[0], n[1], n[2]);
        break;
      }
      case 'sc': case 'scn': case 'SC': case 'SCN': {
        const stroke = o === 'SC' || o === 'SCN';
        const cs = stroke ? st.strokeCS : st.fillCS;
        const n = nums(op.operands);
        if (cs === 'DeviceRGB' && n.length === 3) { rgbColor(op, stroke, n[0], n[1], n[2]); break; }
        if (op.operands.some((x) => x.kind === 'name')) bump(stats.otherColorOps, `${o}(pattern)`);
        else if (cs.startsWith('GalleySep') || cs === 'DeviceCMYK' || cs === 'DeviceGray') bump(stats.otherColorOps, o);
        else stats.unhandled.push(`${where}: ${o} in colour space /${cs} @${op.start}`);
        insertBefore(op, syncOverprint(stroke ? st.opFill : false, stroke ? false : st.opStroke));
        break;
      }
      case 'cs': case 'CS': {
        const stroke = o === 'CS';
        const name = op.operands[0]?.kind === 'name' ? op.operands[0].value : '?';
        if (stroke) st.strokeCS = name; else st.fillCS = name;
        bump(stats.otherColorOps, o + (name === 'Pattern' ? '(Pattern)' : ''));
        insertBefore(op, syncOverprint(stroke ? st.opFill : false, stroke ? false : st.opStroke));
        break;
      }
      case 'g': case 'G': case 'k': case 'K': {
        const stroke = o === 'G' || o === 'K';
        bump(stats.otherColorOps, o);
        if (stroke) st.strokeCS = o === 'G' ? 'DeviceGray' : 'DeviceCMYK'; else st.fillCS = o === 'g' ? 'DeviceGray' : 'DeviceCMYK';
        insertBefore(op, syncOverprint(stroke ? st.opFill : false, stroke ? false : st.opStroke));
        break;
      }
      case 'Do': case 'sh': case 'BI':
        // Forms inherit the graphics state; never let overprint leak into one.
        insertBefore(op, syncOverprint(false, false));
        break;
      default: break;
    }
  }
  out += src.slice(cursor);
  return { out, spotsUsed, gsUsed, stats };
}
