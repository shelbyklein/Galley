// Independent PDF acceptance for the UI-built Phase 2 flyer. Screen lines come from DOM Ranges, never the engine's
// slices. Poppler supplies the printed words; Ghostscript supplies the ink plates.
// tsx scripts/milestone2/check-flyer.ts <pdf> <package> <screen.json> <work-dir>
import { parseDocument } from '@galley/model';
import { exportPage, pageBoxes } from '@galley/prepress';
import { measureRegion, runGoldenChecks, separate } from '@galley/prepress/verify';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { readPackage } from '../golden/lib/app';

interface Line { text: string; cy: number; baseline: number; left: number; right: number; pseudoHyphen?: boolean }
interface ScreenFrame { id: string; x: number; y: number; w: number; h: number; lines: Line[] }
interface ScreenProof {
  frames: ScreenFrame[];
  blackFrameId: string;
  staticFamily: string;
  variableFamily: string;
}
interface Word { text: string; x0: number; y0: number; x1: number; y1: number }

const env = { ...process.env, PATH: `${process.env.PATH ?? ''}:/opt/homebrew/bin:/usr/local/bin` };
const tool = (name: string, args: string[]) => execFileSync(name, args, { encoding: 'utf8', env, maxBuffer: 128 << 20 });
const normalize = (text: string) => text.normalize('NFKC').replace(/\u00ad/g, '').replace(/[\u2010\u2011]/g, '-').replace(/\s+/g, ' ').trim();
const xmlText = (text: string) => text.replace(/&#(?:x([\da-f]+)|(\d+));/gi, (_, hex, dec) => String.fromCodePoint(Number.parseInt(hex ?? dec, hex ? 16 : 10)))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&amp;/g, '&');

async function main() {
  const [pdf, pkg, screenFile, work] = process.argv.slice(2);
  if (!pdf || !pkg || !screenFile || !work) throw new Error('usage: check-flyer <pdf> <package> <screen.json> <work-dir>');
  const doc = parseDocument(readPackage(pkg));
  const screen = JSON.parse(fs.readFileSync(screenFile, 'utf8')) as ScreenProof;
  if (screen.frames.length < 2 || !screen.staticFamily || !screen.variableFamily) throw new Error('Missing screen/font evidence');
  const options = { bleed: true, marks: true };
  const boxes = pageBoxes(exportPage(doc.pages[doc.pageOrder[0]!]!, options));
  const checks = await runGoldenChecks({ pdfPath: pdf, doc, options, workDir: path.join(work, 'golden') });
  const xml = tool('pdftotext', ['-bbox-layout', pdf, '-']);
  const words: Word[] = [...xml.matchAll(/<word xMin="([-\d.]+)" yMin="([-\d.]+)" xMax="([-\d.]+)" yMax="([-\d.]+)">([^<]*)<\/word>/g)].map(m => ({
    x0: Number(m[1]) - boxes.trim.x, y0: Number(m[2]) - boxes.trim.y,
    x1: Number(m[3]) - boxes.trim.x, y1: Number(m[4]) - boxes.trim.y, text: xmlText(m[5]!),
  }));
  const pdfBaselines = JSON.parse(tool(process.env.GALLEY_PROOF_PYTHON ?? 'python3', [path.join(import.meta.dirname, 'pdf-baselines.py'), pdf])) as { text: string; x: number; baseline: number }[];
  const mismatches: string[] = [];
  const verticalOffsets: number[] = [];
  let lines = 0;
  let dxMax = 0;
  let baselineMax = 0;
  for (const frame of screen.frames) {
    const baselines = pdfBaselines.map(l => ({ ...l, x: l.x - boxes.trim.x, baseline: l.baseline - boxes.trim.y }))
      .filter(l => l.x >= frame.x - 0.5 && l.x <= frame.x + frame.w + 0.5 && l.baseline >= frame.y - 0.5 && l.baseline <= frame.y + frame.h + 0.5)
      .sort((a, b) => a.baseline - b.baseline || a.x - b.x);
    if (baselines.length !== frame.lines.length) mismatches.push(`${frame.id}: ${frame.lines.length} screen baselines / ${baselines.length} PDF text origins`);
    for (let i = 0; i < Math.min(frame.lines.length, baselines.length); i++) {
      const a = frame.lines[i]!, b = baselines[i]!;
      if (normalize(a.text) !== normalize(b.text)) mismatches.push(`${frame.id} baseline ${i}: screen ${JSON.stringify(a.text)} / PDF ${JSON.stringify(b.text)}`);
      if (!Number.isFinite(a.baseline)) throw new Error(`Missing screen baseline ${frame.id} line ${i}`);
      baselineMax = Math.max(baselineMax, Math.abs(a.baseline - b.baseline));
    }
    const inside = words.filter(w => {
      const x = (w.x0 + w.x1) / 2, y = (w.y0 + w.y1) / 2;
      return x >= frame.x - 0.5 && x <= frame.x + frame.w + 0.5 && y >= frame.y - 0.5 && y <= frame.y + frame.h + 0.5;
    }).sort((a, b) => (a.y0 + a.y1) - (b.y0 + b.y1) || a.x0 - b.x0);
    const groups: Word[][] = [];
    for (const word of inside) {
      const last = groups.at(-1), cy = (word.y0 + word.y1) / 2;
      if (last && Math.abs(cy - (last[0]!.y0 + last[0]!.y1) / 2) < 3) last.push(word);
      else groups.push([word]);
    }
    const printed = groups.map(group => {
      group.sort((a, b) => a.x0 - b.x0);
      return { text: normalize(group.map(w => w.text).join(' ')), cy: group.reduce((sum, w) => sum + (w.y0 + w.y1) / 2, 0) / group.length,
        left: Math.min(...group.map(w => w.x0)), right: Math.max(...group.map(w => w.x1)) };
    });
    lines += frame.lines.length;
    if (frame.lines.length !== printed.length) mismatches.push(`${frame.id}: ${frame.lines.length} screen lines / ${printed.length} PDF lines`);
    for (let i = 0; i < Math.min(frame.lines.length, printed.length); i++) {
      const a = frame.lines[i]!, b = printed[i]!;
      if (normalize(a.text) !== b.text) mismatches.push(`${frame.id} line ${i}: screen ${JSON.stringify(a.text)} / PDF ${JSON.stringify(b.text)}`);
      else {
        verticalOffsets.push(b.cy - a.cy);
        dxMax = Math.max(dxMax, Math.abs(b.left - a.left), a.pseudoHyphen ? 0 : Math.abs(b.right - a.right));
      }
    }
  }
  const mean = verticalOffsets.reduce((s, v) => s + v, 0) / (verticalOffsets.length || 1);
  const dySpread = Math.max(0, ...verticalOffsets.map(v => Math.abs(v - mean)));
  const lineMatch = { lines, mismatches: mismatches.length, details: mismatches.slice(0, 20), dxMax, baselineMax, boxCenterOffset: mean, dySpread };
  checks.push({ group: 'text', name: 'UI flyer screen/PDF line agreement', expected: '20+ lines, 0 mismatches, horizontal bounds within 0.5 pt, absolute baselines within 0.1 pt',
    measured: JSON.stringify(lineMatch), pass: lines >= 20 && mismatches.length === 0 && dxMax < 0.5 && baselineMax <= 0.1 && dySpread < 0.5 });

  const fontOutput = tool('pdffonts', [pdf]);
  const fontRows = fontOutput.trim().split('\n').slice(2).filter(Boolean);
  const fonts = fontRows.map(row => {
    const m = /^(\S+)\s+(.+?)\s+\S+\s+(yes|no)\s+(yes|no)\s+(yes|no)\s+\d+\s+\d+/.exec(row);
    if (!m) throw new Error(`Unrecognized pdffonts row: ${row}`);
    return { name: m[1]!, type: m[2]!.trim(), embedded: m[3] === 'yes' };
  });
  const familyKey = (s: string) => s.replace(/^[A-Z]{6}\+/, '').replace(/[^a-z0-9]/gi, '').toLowerCase();
  for (const [kind, family] of [['static', screen.staticFamily], ['variable', screen.variableFamily]] as const) {
    const found = fonts.filter(f => familyKey(f.name).includes(familyKey(family)));
    checks.push({ group: 'fonts', name: `${kind} font ${family} is embedded as real TrueType`, expected: 'embedded CID TrueType, no Type 3',
      measured: JSON.stringify(found), pass: found.length > 0 && found.every(f => f.embedded && f.type === 'CID TrueType') });
  }
  checks.push({ group: 'fonts', name: 'flyer has no outlined Type 3 fonts', expected: 'all fonts embedded, no Type 3', measured: JSON.stringify(fonts),
    pass: fonts.length >= 2 && fonts.every(f => f.embedded && !/Type 3/.test(f.type)) });
  const black = doc.frames[screen.blackFrameId];
  if (!black || black.type !== 'text' || black.rotation !== 0) throw new Error('Missing upright black body frame');
  const seps = await separate(pdf, path.join(work, 'body-plates'));
  const measure = measureRegion(seps, { x: (black.x + boxes.trim.x) * seps.scale, y: (black.y + boxes.trim.y) * seps.scale,
    w: black.w * seps.scale, h: black.h * seps.scale });
  checks.push({ group: 'ink', name: 'styled threaded body remains pure K100', expected: 'C0 M0 Y0 K100 and no spot ink', measured: JSON.stringify(measure.max),
    pass: measure.max.C === 0 && measure.max.M === 0 && measure.max.Y === 0 && measure.max.K >= 99 && Object.values(measure.spots).every(p => p.max === 0) });
  console.log(JSON.stringify({ checks, lineMatch, fonts, fontOutput }));
  process.exit(checks.every(c => c.pass) ? 0 : 1);
}
main().catch(error => { console.error(error); process.exit(2); });
