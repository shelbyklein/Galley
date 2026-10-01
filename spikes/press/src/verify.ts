// Automated verification of out/galley-press-spike.pdf.
//   - Ghostscript tiffsep separations, measured against the swatch definitions
//   - pdffonts / pdfimages / pdfinfo / qpdf --check
//   - RGB-leftover scan of the output PDF (content streams + resources)
//   - self-made PDF/X-4 structure checks (NOT a substitute for Acrobat Preflight / callas)
//   - preview PNG via pdftoppm
// Exits non-zero if any check fails.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef } from '@cantoo/pdf-lib';
import sharp from 'sharp';
import { readPlate, stats, type Plate, type Rect } from './plates.ts';
import { scanRgb } from './rgbscan.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const P = (...a: string[]) => path.join(root, ...a);
const OUT_PDF = P(process.argv.find((a) => a.startsWith('--pdf='))?.split('=')[1] ?? 'out/galley-press-spike.pdf');
const GRACOL = '/Library/Application Support/Adobe/Color/Profiles/Recommended/CoatedGRACoL2006.icc';
const DPI = 144;
const S = (0.75 * DPI) / 72; // CSS px -> device px (CSS px = 0.75pt)

const regions: Record<string, { x: number; y: number; w: number; h: number }> = JSON.parse(fs.readFileSync(P('build/regions.json'), 'utf8')).regions;
const sentinels: any[] = JSON.parse(fs.readFileSync(P('build/sentinels.json'), 'utf8'));
const geom = JSON.parse(fs.readFileSync(P('geometry.json'), 'utf8'));
const swatch = (id: string) => sentinels.find((s) => s.id === id)!;
const cmykOf = (id: string) => { const s = swatch(id); return (s.values as number[]).map((v) => (v * s.tint) / 100); };

// ------------------------------------------------------------------ reporting
interface Check { group: string; name: string; expected: string; measured: string; pass: boolean }
const checks: Check[] = [];
const out: string[] = [];
const log = (s = '') => { console.log(s); out.push(s); };
const check = (group: string, name: string, expected: string, measured: string, pass: boolean) => {
  checks.push({ group, name, expected, measured, pass });
  log(`  [${pass ? 'PASS' : 'FAIL'}] ${name.padEnd(46)} expected ${expected.padEnd(28)} measured ${measured}`);
};
const f1 = (v: number) => v.toFixed(1);
const within = (v: number, e: number, tol: number) => Math.abs(v - e) <= tol;
const sh = (cmd: string, args: string[], opts: any = {}) => spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 << 20, ...opts });

// ------------------------------------------------------------------ ghostscript separations
interface Seps { C: Plate; M: Plate; Y: Plate; K: Plate; spots: Record<string, Plate> }
async function separate(pdf: string, dir: string): Promise<Seps> {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const r = sh('gs', ['-q', '-dBATCH', '-dNOPAUSE', '-sDEVICE=tiffsep', `-r${DPI}`, `-sOutputFile=${path.join(dir, 'p%d.tif')}`, pdf]);
  if (r.status !== 0) throw new Error('gs failed: ' + r.stderr);
  const files = fs.readdirSync(dir).filter((f) => /^p1\(.+\)\.tif$/.test(f));
  const named: Record<string, Plate> = {};
  for (const f of files) { const n = f.match(/^p1\((.+)\)\.tif$/)![1]; named[n] = await readPlate(path.join(dir, f), n); }
  const { Cyan: C, Magenta: M, Yellow: Y, Black: K, ...spots } = named;
  return { C, M, Y, K, spots };
}

const rect = (name: string, o: { dx?: number; dy?: number; w?: number; h?: number } = {}): Rect => {
  const r = regions[name];
  if (!r) throw new Error('unknown region ' + name);
  return { x: (r.x + (o.dx ?? 0)) * S, y: (r.y + (o.dy ?? 0)) * S, w: (o.w ?? r.w - (o.dx ?? 0)) * S, h: (o.h ?? r.h - (o.dy ?? 0)) * S };
};
const inch = (x: number, y: number, w: number, h: number): Rect => ({ x: x * 96 * S, y: y * 96 * S, w: w * 96 * S, h: h * 96 * S }); // sheet inches -> device px
const mean4 = (s: Seps, r: Rect, pred?: (i: number) => boolean) => ({
  C: stats(s.C, r, pred).mean, M: stats(s.M, r, pred).mean, Y: stats(s.Y, r, pred).mean, K: stats(s.K, r, pred).mean,
  n: stats(s.K, r, pred).n,
});
const fmt4 = (m: { C: number; M: number; Y: number; K: number }) => `C${f1(m.C)} M${f1(m.M)} Y${f1(m.Y)} K${f1(m.K)}`;

// ------------------------------------------------------------------ main
async function main() {
  log(`# Galley press spike: verify ${path.relative(root, OUT_PDF)}`);
  log(`  gs ${sh('gs', ['--version']).stdout.trim()}, qpdf ${(sh('qpdf', ['--version']).stdout.split('\n')[0] || 'MISSING').trim()}, ${(sh('pdftoppm', ['-v']).stderr.split('\n')[0] || '').trim()}`);

  // 1. structure ------------------------------------------------------------------
  log('\n## 1. File structure / PDF/X-4 self-preflight');
  const q = sh('qpdf', ['--check', OUT_PDF]);
  check('structure', 'qpdf --check', 'no syntax/stream errors', q.status === 0 && /No syntax or stream encoding errors/.test(q.stdout) ? 'clean' : (q.stdout + q.stderr).slice(0, 200), q.status === 0 && /No syntax or stream encoding errors/.test(q.stdout));
  const pinfo = sh('pdfinfo', ['-box', '-isodates', OUT_PDF]).stdout;
  const box = (n: string) => (pinfo.match(new RegExp(`^${n}:\\s+(.*)$`, 'm'))?.[1] ?? '').trim().split(/\s+/).map(Number);
  const margin = geom.marginIn * 72, tw = geom.trimIn[0] * 72, th = geom.trimIn[1] * 72, bl = geom.bleedIn * 72;
  const exp = { MediaBox: [0, 0, tw + 2 * margin, th + 2 * margin], TrimBox: [margin, margin, margin + tw, margin + th], BleedBox: [margin - bl, margin - bl, margin + tw + bl, margin + th + bl] };
  for (const [k, e] of Object.entries(exp)) { const m = box(k); check('structure', `${k} (pt)`, e.join(' '), m.join(' '), e.every((v, i) => within(m[i], v, 0.01))); }
  const bleedInMedia = box('BleedBox')[0] >= box('MediaBox')[0] && box('TrimBox')[0] >= box('BleedBox')[0];
  check('structure', 'boxes nested: Trim within Bleed within Media', 'true', String(bleedInMedia), bleedInMedia);
  log('\n  pdfinfo (selected):');
  for (const l of pinfo.split('\n').filter((l) => /PDF version|PDF subtype|Standard|Page size|Title|Pages/.test(l))) log('    ' + l.trim());

  const { left, info, doc } = await scanRgb(OUT_PDF);
  const ctx = doc.context;
  const catalog = doc.catalog;
  const infoDict = ctx.lookup(ctx.trailerInfo.Info) as PDFDict;
  const hdr = fs.readFileSync(OUT_PDF).subarray(0, 8).toString('latin1');
  check('pdfx', 'header version', '%PDF-1.6', hdr, hdr === '%PDF-1.6');
  const gts = infoDict.get(PDFName.of('GTS_PDFXVersion'))?.toString();
  check('pdfx', 'Info /GTS_PDFXVersion', '(PDF/X-4)', String(gts), gts === '(PDF/X-4)');
  const trapped = infoDict.get(PDFName.of('Trapped'))?.toString();
  check('pdfx', 'Info /Trapped', '/False', String(trapped), trapped === '/False');
  const mdRef = ctx.lookup(catalog.get(PDFName.of('Metadata'))) as PDFRawStream | undefined;
  const xmp = mdRef ? Buffer.from(mdRef.contents).toString('utf8') : '';
  check('pdfx', 'XMP pdfxid:GTS_PDFXVersion', 'PDF/X-4', (xmp.match(/<pdfxid:GTS_PDFXVersion>(.*?)</)?.[1]) ?? 'missing', /<pdfxid:GTS_PDFXVersion>PDF\/X-4</.test(xmp));
  check('pdfx', 'XMP pdf:Trapped / xmpMM ids', 'False + DocumentID', `${xmp.match(/<pdf:Trapped>(.*?)</)?.[1]} / ${xmp.includes('xmpMM:DocumentID') ? 'present' : 'missing'}`, /<pdf:Trapped>False</.test(xmp) && xmp.includes('xmpMM:DocumentID'));
  const idArr = ctx.trailerInfo.ID;
  check('pdfx', 'trailer /ID (document ID)', '2 strings', idArr instanceof PDFArray ? `${idArr.size()} strings` : 'missing', idArr instanceof PDFArray && idArr.size() === 2);
  const oi = ctx.lookup((ctx.lookup(catalog.get(PDFName.of('OutputIntents'))) as PDFArray | undefined)?.get(0)) as PDFDict | undefined;
  const oiProfile = oi && (ctx.lookup(oi.get(PDFName.of('DestOutputProfile'))) as PDFRawStream | undefined);
  const oiN = oiProfile ? (ctx.lookup(oiProfile.dict.get(PDFName.of('N')), PDFNumber) as PDFNumber).asNumber() : 0;
  check('pdfx', 'OutputIntent /S /GTS_PDFX + CMYK ICC (N=4)', 'GTS_PDFX, N=4', `${oi?.get(PDFName.of('S'))?.toString()}, N=${oiN}, ${oi?.get(PDFName.of('OutputConditionIdentifier'))?.toString()}`, oi?.get(PDFName.of('S'))?.toString() === '/GTS_PDFX' && oiN === 4);
  const enc = !!ctx.trailerInfo.Encrypt;
  check('pdfx', 'not encrypted', 'false', String(enc), !enc);

  // 2. fonts -----------------------------------------------------------------------
  log('\n## 2. Fonts (pdffonts)');
  const pf = sh('pdffonts', [OUT_PDF]).stdout;
  log(pf.split('\n').map((l) => '    ' + l).join('\n').trimEnd());
  const fontRows = pf.split('\n').slice(2).filter((l) => l.trim());
  const rows = fontRows.map((l) => { const m = l.match(/^(\S+)\s+(.+?)\s{2,}(\S+)\s+(yes|no)\s+(yes|no)\s+(yes|no)/); return m ? { name: m[1], type: m[2].trim(), emb: m[4] } : null; }).filter(Boolean) as { name: string; type: string; emb: string }[];
  check('fonts', 'all fonts embedded', `${rows.length}/${rows.length}`, `${rows.filter((r) => r.emb === 'yes').length}/${rows.length}`, rows.every((r) => r.emb === 'yes'));
  const t3 = rows.filter((r) => r.type === 'Type 3');
  log(`  -> static fonts: ${rows.filter((r) => r.type !== 'Type 3').map((r) => `${r.name} (${r.type})`).join(', ')}`);
  log(`  -> variable font came out as Type 3: ${t3.length ? 'YES (' + t3.map((r) => r.name).join(', ') + ')' : 'no'}`);

  // 3. RGB leftovers ---------------------------------------------------------------
  log('\n## 3. DeviceRGB leftovers');
  log(`  streams scanned: ${info.streamsScanned}; DeviceGray ops (g/G, allowed): ${info.grayOps}; soft-mask objects exempt (alpha/luminosity data, not ink): ${info.maskObjects ?? 0}`);
  check('rgb', 'DeviceRGB vector colour ops (rg/RG/cs)', '0', String(left.filter((l) => /rg|RG|cs \/DeviceRGB|vector/.test(l.what)).length), left.filter((l) => /vector|cs \/DeviceRGB/.test(l.what)).length === 0);
  const ALLOW_ICC = process.argv.includes('--allow-icc-rgb'); // alt photo mode: ICC-tagged RGB images are legal in PDF/X-4
  const rgbNonImage = left.filter((l) => !/vector|cs \/DeviceRGB/.test(l.what) && !(ALLOW_ICC && /^image .* in ICCBased\(N=3\)$/.test(l.what)));
  check('rgb', 'RGB image/shading/group/resource colour spaces' + (ALLOW_ICC ? ' (ICC-tagged RGB images allowed)' : ''), '0', String(rgbNonImage.length), rgbNonImage.length === 0);
  for (const l of left) log(`    leftover: ${l.where}: ${l.what}`);

  // 4. separations -----------------------------------------------------------------
  log('\n## 4. Ghostscript tiffsep separations @ ' + DPI + ' dpi');
  const sepDir = P('out/sep');
  const sep = await separate(OUT_PDF, sepDir);
  log(`  plates: Cyan Magenta Yellow Black + spot ${Object.keys(sep.spots).map((n) => `"${n}"`).join(', ') || '(none)'} ; plate size ${sep.K.w}x${sep.K.h}`);
  log('  pixel convention: 8-bit gray TIFF, BlackIsZero, LZW; 255 = no ink, 0 = 100% ink (ink% = (255-v)/255*100)');
  const spotPlate = sep.spots['PANTONE 185 C'];
  // contact sheet of the plates (dark = ink)
  {
    const names: [string, string][] = [['Cyan', 'Cyan'], ['Magenta', 'Magenta'], ['Yellow', 'Yellow'], ['Black', 'Black'], ...Object.keys(sep.spots).map((n) => [n, n] as [string, string])];
    const w = 330, h = Math.round((sep.K.h / sep.K.w) * w), pad = 8, cap = 22;
    const tiles = await Promise.all(names.map(async ([file, label], i) => ({
      input: await sharp(path.join(sepDir, `p1(${file}).tif`)).resize(w, h).png().toBuffer(), left: pad + i * (w + pad), top: pad + cap,
      label,
    })));
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${pad + names.length * (w + pad)}" height="${h + cap + 2 * pad}"><rect width="100%" height="100%" fill="#ffffff"/>${tiles.map((t) => `<text x="${t.left}" y="${pad + 14}" font-family="Helvetica,Arial" font-size="14" fill="#222">${t.label}</text>`).join('')}</svg>`;
    await sharp(Buffer.from(svg)).composite(tiles.map((t) => ({ input: t.input, left: t.left, top: t.top }))).png().toFile(P('out/separations-contact-sheet.png'));
    log('  wrote out/separations-contact-sheet.png (all plates, dark = ink)');
  }
  check('spot', 'spot colour has its own named plate', '"PANTONE 185 C"', Object.keys(sep.spots).join(', ') || 'none', !!spotPlate);

  const TOL = 2;
  // background (bleed included)
  for (const r of ['background-probe', 'background-probe-bleed-right']) {
    const m = mean4(sep, rect(r)); const e = cmykOf('orange');
    check('color', `background ${r.replace('background-', '')}`, `C${e[0]} M${e[1]} Y${e[2]} K${e[3]}`, fmt4(m), within(m.C, e[0], TOL) && within(m.M, e[1], TOL) && within(m.Y, e[2], TOL) && within(m.K, e[3], TOL));
  }
  // bleed extent: inside bleed (0.375..0.5in) is inked, outside bleed (<0.375in) is empty
  const inBleed = mean4(sep, inch(0.385, 1.2, 0.1, 1.5)), outBleed = mean4(sep, inch(0.05, 1.2, 0.3, 1.5));
  check('geometry', 'ink reaches bleed edge (x 0.385-0.485in)', 'Y100', `Y${f1(inBleed.Y)}`, within(inBleed.Y, 100, TOL));
  check('geometry', 'no ink beyond bleed (x 0.05-0.35in, no marks)', 'all 0', fmt4(outBleed), outBleed.C + outBleed.M + outBleed.Y + outBleed.K < 0.5);

  // headline interior (pixels on the cyan plate >= 99): expect the Deep Blue swatch, knocked out of the orange
  {
    const hr = rect('headline'); const e = cmykOf('blue');
    const m = mean4(sep, hr, (i) => sep.C.ink[i] >= 99);
    check('color', 'headline interior (n=' + m.n + ' px)', `C${e[0]} M${e[1]} Y${e[2]} K${e[3]}`, fmt4(m), m.n > 500 && within(m.C, e[0], TOL) && within(m.M, e[1], TOL) && within(m.Y, e[2], TOL) && within(m.K, e[3], TOL));
  }
  // 100K body text: only the Black plate may carry ink
  for (const [label, rn] of [['body text paragraph', 'body-text'], ['variable-font line (Type 3)', 'variable-font'], ['static-instance line (TrueType)', 'instance-font']] as const) {
    const r = rect(rn);
    const mx = { C: stats(sep.C, r).max, M: stats(sep.M, r).max, Y: stats(sep.Y, r).max, S: spotPlate ? stats(spotPlate, r).max : 0, K: stats(sep.K, r).max };
    check('black', `${label}: C/M/Y/spot plates empty`, 'max 0.0', `max C${f1(mx.C)} M${f1(mx.M)} Y${f1(mx.Y)} S${f1(mx.S)}`, mx.C + mx.M + mx.Y + mx.S === 0);
    check('black', `${label}: Black plate carries the ink`, 'max >= 99', `K max ${f1(mx.K)}`, mx.K >= 99);
  }
  // kicker is black text on the orange band (knockout): expect K=100 interior and C/Y/M == 0 at glyph interior
  {
    const r = rect('kicker'); const m = mean4(sep, r, (i) => sep.K.ink[i] >= 99);
    check('black', 'kicker glyph interior knocks out orange (M,Y=0)', 'M0 Y0 K100', fmt4(m), m.n > 50 && m.M < 2 && m.Y < 2 && m.K >= 99);
  }
  // spot colour
  {
    const sp = rect('spot-block', { dx: 8, dy: 8, w: 48, h: 38 }), st = rect('spot-tint-block', { dx: 8, dy: 8, w: 48, h: 38 });
    if (spotPlate) {
      const full = stats(spotPlate, sp).mean, tint = stats(spotPlate, st).mean;
      const oc = mean4(sep, sp);
      check('spot', 'spot block: PANTONE plate = 100%', '100 +/-2', f1(full), within(full, 100, TOL));
      check('spot', 'spot block: CMYK plates empty (no separation to process)', 'C0 M0 Y0 K0', fmt4(oc), oc.C + oc.M + oc.Y + oc.K < 0.5);
      check('spot', 'spot 40% tint: PANTONE plate = 40%', '40 +/-2', f1(tint), within(tint, 40, TOL));
    }
  }
  // CMYK tint
  {
    const full = mean4(sep, rect('teal-block', { dx: 8, dy: 8, w: 48, h: 38 })), half = mean4(sep, rect('teal-tint-block', { dx: 10, dy: 10, w: 46, h: 36 }));
    const ef = cmykOf('teal'), eh = cmykOf('teal-50');
    check('color', 'teal swatch 100%', ef.join('/'), fmt4(full), within(full.C, ef[0], TOL) && within(full.M, ef[1], TOL) && within(full.Y, ef[2], TOL) && within(full.K, ef[3], TOL));
    check('color', 'teal 50% tint', eh.join('/'), fmt4(half), within(half.C, eh[0], TOL) && within(half.M, eh[1], TOL) && within(half.Y, eh[2], TOL) && within(half.K, eh[3], TOL));
  }
  // gradients: sample interior columns, compare against linear interpolation in CMYK
  {
    const g2 = regions['gradient-2stop'], g3 = regions['gradient-3stop'];
    const at = (g: typeof g2, t: number) => mean4(sep, { x: (g.x + g.w * t - 2) * S, y: (g.y + g.h * 0.4) * S, w: 4 * S, h: g.h * 0.2 * S });
    const lerp = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t);
    const cy = cmykOf('cyan'), ma = cmykOf('magenta'), ye = cmykOf('yellow');
    for (const t of [0.05, 0.25, 0.5, 0.75, 0.95]) {
      const e = lerp(cy, ma, t), m = at(g2, t);
      check('gradient', `2-stop cyan->magenta @ ${Math.round(t * 100)}%`, e.map(f1).join('/'), fmt4(m), [m.C, m.M, m.Y, m.K].every((v, i) => within(v, e[i], 3)));
    }
    for (const t of [0.05, 0.25, 0.5, 0.75, 0.95]) {
      const e = t <= 0.5 ? lerp(cy, ye, t / 0.5) : lerp(ye, ma, (t - 0.5) / 0.5), m = at(g3, t);
      check('gradient', `3-stop cyan->yellow->magenta @ ${Math.round(t * 100)}%`, e.map(f1).join('/'), fmt4(m), [m.C, m.M, m.Y, m.K].every((v, i) => within(v, e[i], 3)));
    }
  }
  // transparency
  {
    const a = mean4(sep, rect('transparency-A-only')), b = mean4(sep, rect('transparency-B-only')), ov = mean4(sep, rect('transparency-overlap'));
    const cy = cmykOf('cyan'), or = cmykOf('orange');
    const eb = or.map((v) => v * 0.5), eo = cy.map((v, i) => v * 0.5 + or[i] * 0.5);
    check('transparency', 'object A alone (opaque cyan)', cy.join('/'), fmt4(a), within(a.C, 100, TOL) && a.M + a.Y + a.K < 1);
    check('transparency', 'object B alone (orange @ 50% on paper)', eb.join('/'), fmt4(b), within(b.M, eb[1], TOL) && within(b.Y, eb[2], TOL) && b.C + b.K < 1);
    check('transparency', 'overlap (B 50% over A), CMYK blend', eo.join('/'), fmt4(ov), within(ov.C, eo[0], TOL) && within(ov.M, eo[1], TOL) && within(ov.Y, eo[2], TOL) && ov.K < 1);
  }
  // overprint vs knockout: interior pixels of the black glyphs (K>=99) over Warm Orange
  {
    const op = mean4(sep, rect('overprint-text'), (i) => sep.K.ink[i] >= 99), ko = mean4(sep, rect('knockout-text'), (i) => sep.K.ink[i] >= 99);
    check('overprint', `overprint text interior keeps orange (n=${op.n})`, 'M60 Y100 K100', fmt4(op), op.n > 500 && within(op.M, 60, TOL) && within(op.Y, 100, TOL) && op.K >= 99);
    check('overprint', `knockout text interior removes orange (n=${ko.n})`, 'M0 Y0 K100', fmt4(ko), ko.n > 500 && ko.M < 1 && ko.Y < 1 && ko.K >= 99);
    // no leak: objects painted AFTER the overprint object must knock out. The knockout line is next in the stream; the swatch
    // labels (black text on teal tint / spot tint, painted much later) would keep teal/spot ink under the glyphs if overprint leaked.
    const lab = mean4(sep, rect('teal-tint-block', { dx: 4, dy: 60, w: 120, h: 24 }), (i) => sep.K.ink[i] >= 99);
    check('overprint', `no leak: black label on teal tint knocks out (n=${lab.n})`, 'C0 M0 Y0 K100', fmt4(lab), lab.n > 20 && lab.C < 1 && lab.M < 1 && lab.Y < 1 && lab.K >= 99);
    if (spotPlate) {
      const sl = stats(spotPlate, rect('spot-tint-block', { dx: 4, dy: 60, w: 120, h: 24 }), (i) => sep.K.ink[i] >= 99);
      check('overprint', `no leak: black label on spot tint knocks out spot plate (n=${sl.n})`, 'spot 0', f1(sl.mean), sl.n > 20 && sl.mean < 1);
    }
  }
  // fade to transparent over paper: only the Black plate, increasing
  {
    const fr = regions['fade-strip'];
    const at = (t: number) => mean4(sep, { x: (fr.x + fr.w * t - 2) * S, y: (fr.y + fr.h * 0.7) * S, w: 4 * S, h: fr.h * 0.2 * S });
    const m = [0.4, 0.6, 0.8, 0.95].map(at);
    check('fade', 'fade strip is K-only', 'C0 M0 Y0', m.map((x) => `C${f1(x.C)}M${f1(x.M)}Y${f1(x.Y)}`).join(' '), m.every((x) => x.C + x.M + x.Y < 0.5));
    const exp = [0.4, 0.6, 0.8, 0.95].map((t) => 85 * t);
    check('fade', 'fade K ramp = 85% x position (+/-4)', exp.map(f1).join('/'), m.map((x) => f1(x.K)).join('/'), m.every((x, i) => within(x.K, exp[i], 4)));
  }
  // photo: converted CMYK vs independent gs conversion of the original RGB
  {
    const r = rect('photo', { dx: 4, dy: 4, w: regions['photo'].w - 8, h: regions['photo'].h - 8 });
    const m = mean4(sep, r);
    log(`  photo region mean ink (our CMYK image): ${fmt4(m)}`);
    check('photo', 'photo carries ink on all four process plates', '>5% each', fmt4(m), m.C > 5 && m.M > 5 && m.Y > 5 && m.K > 5);
    // independent conversion: Ghostscript/lcms converts the ORIGINAL ICC-tagged RGB photo (from the unprocessed Chromium PDF)
    // to CMYK through the same GRACoL profile; compare plate means over the photo region.
    const xdir = P('out/sep-photo-xcheck');
    fs.rmSync(xdir, { recursive: true, force: true }); fs.mkdirSync(xdir, { recursive: true });
    const g = sh('gs', ['-q', '-dBATCH', '-dNOPAUSE', '-sDEVICE=tiffsep', `-r${DPI}`, `-sOutputICCProfile=${GRACOL}`, `-sOutputFile=${xdir}/p%d.tif`, P('build/chromium.pdf')]);
    if (g.status === 0) {
      const xs: Seps = { C: await readPlate(`${xdir}/p1(Cyan).tif`, 'C'), M: await readPlate(`${xdir}/p1(Magenta).tif`, 'M'), Y: await readPlate(`${xdir}/p1(Yellow).tif`, 'Y'), K: await readPlate(`${xdir}/p1(Black).tif`, 'K'), spots: {} };
      const xm = mean4(xs, r);
      const d = [m.C - xm.C, m.M - xm.M, m.Y - xm.Y, m.K - xm.K];
      log(`  photo cross-check: sharp/lcms CMYK ${fmt4(m)} vs Ghostscript/lcms CMYK of original RGB ${fmt4(xm)} (diff ${d.map(f1).join('/')})`);
      check('photo', 'sharp CMYK conversion ~ gs conversion via same profile (mean/plate)', 'within 6 pts', d.map(f1).join('/'), d.every((v) => Math.abs(v) <= 6));
    }
  }
  // drop shadow (blur): Skia emits sentinel-coloured vector fill + gray luminosity soft mask => K-only, no RGB
  {
    const pr = regions['photo'];
    const r: Rect = { x: (pr.x + pr.w + 1) * S, y: (pr.y + 12) * S, w: 5 * S, h: (pr.h - 24) * S };
    const m = mean4(sep, r);
    check('shadow', 'box-shadow right of photo is K-only and non-empty', 'C/M/Y 0, K>3', fmt4(m), m.C + m.M + m.Y < 0.5 && m.K > 3);
  }
  // marks (registration colour: all plates incl. spot)
  {
    // horizontal crop tick left of the trim top edge: x from (margin-12-18) to (margin-12) pt, at y = margin pt (from top)
    const px = (pt: number) => pt * (DPI / 72);
    const r: Rect = { x: px(margin - 12 - 18 + 2), y: px(margin) - 3, w: px(14), h: 7 };
    const mx = { C: stats(sep.C, r).max, M: stats(sep.M, r).max, Y: stats(sep.Y, r).max, K: stats(sep.K, r).max, S: spotPlate ? stats(spotPlate, r).max : -1 };
    check('marks', 'crop mark prints on every plate (/Separation /All)', 'all >= 90', `C${f1(mx.C)} M${f1(mx.M)} Y${f1(mx.Y)} K${f1(mx.K)} spot${f1(mx.S)}`, mx.C >= 90 && mx.M >= 90 && mx.Y >= 90 && mx.K >= 90 && mx.S >= 90);
    const r2: Rect = { x: px(margin - 12 - 18 + 2), y: px(margin) + 10, w: px(14), h: 20 };
    const clear = stats(sep.K, r2).max;
    check('marks', 'slug area between marks is empty', '0', f1(clear), clear === 0);
    // registration target: centre of top target at x = page centre, y = margin-24 pt from bottom -> from top: pageH-... (symmetric) = margin-24
    const rt: Rect = { x: px(margin + tw / 2 - 12), y: px(margin - 24 - 12), w: px(24), h: px(24) };
    check('marks', 'registration target present (top)', 'K max >= 90', `K ${f1(stats(sep.K, rt).max)}`, stats(sep.K, rt).max >= 90);
  }

  // 5. baseline: the same page converted the naive way ------------------------------
  log('\n## 5. Baseline: the same page as plain Chromium RGB PDF (real RGB swatches, no sentinels) through Ghostscript tiffsep');
  if (fs.existsSync(P('build/screen-mode.pdf'))) {
    const base = await separate(P('build/screen-mode.pdf'), P('out/sep-baseline'));
    const bt = mean4(base, rect('body-text'), (i) => base.K.ink[i] >= 5);
    const bmax = { C: stats(base.C, rect('body-text')).max, M: stats(base.M, rect('body-text')).max, Y: stats(base.Y, rect('body-text')).max, K: stats(base.K, rect('body-text')).max };
    log(`  baseline body-text region: max C${f1(bmax.C)} M${f1(bmax.M)} Y${f1(bmax.Y)} K${f1(bmax.K)}  (mean over inked px: ${fmt4(bt)})`);
    log(`  baseline plates: ${Object.keys(base.spots).length ? Object.keys(base.spots).join(', ') : 'no spot plate (PANTONE 185 C became CMYK)'}`);
    const bb = mean4(base, rect('background-probe'));
    log(`  baseline background: ${fmt4(bb)}  (target C0 M60 Y100 K0)`);
    const bh = mean4(base, rect('headline'), (i) => base.C.ink[i] >= 50);
    log(`  baseline headline interior: ${fmt4(bh)}  (target C100 M80 Y0 K20)`);
    check('baseline', 'unprocessed Chromium PDF is NOT K-only on black text (shows why the post-processor exists)', 'C/M/Y > 0', `max C${f1(bmax.C)} M${f1(bmax.M)} Y${f1(bmax.Y)}`, bmax.C + bmax.M + bmax.Y > 0);
  } else log('  (build/screen-mode.pdf missing, skipped)');

  // 6. images ----------------------------------------------------------------------
  log('\n## 6. Images (pdfimages -list)');
  log(sh('pdfimages', ['-list', OUT_PDF]).stdout.split('\n').map((l) => '    ' + l).join('\n').trimEnd());

  // 7. preview ---------------------------------------------------------------------
  log('\n## 7. Preview');
  const prev = P('out/preview');
  sh('pdftoppm', ['-png', '-r', '100', '-singlefile', OUT_PDF, prev]);
  log(`  wrote ${path.relative(root, prev)}.png (pdftoppm, plain RGB render)`);
  sh('pdftoppm', ['-overprint', '-png', '-r', '100', '-singlefile', OUT_PDF, P('out/preview-overprint')]);
  log(`  wrote out/preview-overprint.png (pdftoppm -overprint: independent renderer; the OVERPRINT line should look darker/browner than KNOCKOUT)`);
  if (fs.existsSync(P('build/screen.png'))) { fs.copyFileSync(P('build/screen.png'), P('out/screen-softproof.png')); log('  copied build/screen.png -> out/screen-softproof.png (what the editor shows: soft-proof RGB)'); }
  // composite sanity (gs tiffsep also writes the CMYK composite as p1.tif)
  const comp = await sharp(path.join(sepDir, 'p1.tif')).metadata().catch(() => undefined);
  if (comp) log(`  composite ${comp.width}x${comp.height} ${comp.space}`);

  // summary -----------------------------------------------------------------------
  const failed = checks.filter((c) => !c.pass);
  log(`\n## Summary: ${checks.length - failed.length}/${checks.length} checks passed`);
  for (const f of failed) log(`  FAILED: [${f.group}] ${f.name}: expected ${f.expected}, measured ${f.measured}`);
  fs.writeFileSync(P('out/verify-report.txt'), out.join('\n') + '\n');
  fs.writeFileSync(P('out/verify-report.json'), JSON.stringify({ checks }, null, 2));
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
