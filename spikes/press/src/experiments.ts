// Side experiments that back the claims in FINDINGS.md: page-size quantisation, CSS box snapping, font embedding matrix.
// Usage: tsx src/experiments.ts   (writes out/experiments.txt)
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const P = (...a: string[]) => path.join(root, ...a);
const out: string[] = [];
const log = (s = '') => { console.log(s); out.push(s); };
const run = (cmd: string, args: string[]) => spawnSync(cmd, args, { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20 });
const printPage = (html: string, name: string) => {
  fs.mkdirSync(P('build/exp'), { recursive: true });
  fs.writeFileSync(P('build/exp', `${name}.html`), html);
  const r = run('npx', ['electron', 'electron/main.cjs', `--page=build/exp/${name}.html`, `--out=build/exp-${name}.pdf`]);
  if (r.status !== 0) throw new Error(`electron failed for ${name}: ${r.stderr}`);
  return P('build', `exp-${name}.pdf`);
};
const contentOf = (pdf: string) => {
  run('qpdf', ['--qdf', '--object-streams=disable', pdf, pdf.replace(/\.pdf$/, '.qdf.pdf')]);
  const c = fs.readFileSync(pdf.replace(/\.pdf$/, '.qdf.pdf')).toString('latin1');
  const i = c.indexOf('%% Contents for page 1');
  return c.slice(i, c.indexOf('endstream', i));
};

// ---- 1. page size quantisation
log('## E1. @page size -> actual MediaBox (Chromium quantises to 1/300 in = 0.24 pt)');
log('  requested                    actual (pt)           CTM scale');
for (const sz of ['684pt 864pt', '9.5in 12in', '612pt 792pt', '600pt 400pt', '595.28pt 841.89pt', '300mm 400mm']) {
  const pdf = printPage(`<!doctype html><meta charset="utf-8"><style>@page{size:${sz};margin:0}html,body{margin:0;overflow:hidden}.a{position:absolute;left:0;top:0;width:100px;height:100px;background:rgb(10,10,25)}</style><div class="a"></div>`, 'size');
  const m = run('pdfinfo', [pdf]).stdout.match(/Page size:\s+(.*)/)?.[1] ?? '?';
  const cm = contentOf(pdf).split('\n').filter((l) => / cm$/.test(l)).map((l) => l.split(' ')[0]).join(', ');
  log(`  ${sz.padEnd(28)} ${m.padEnd(21)} ${cm}`);
}

// ---- 1b. overflow => shrink to fit
log('\n## E1b. content wider than the page triggers shrink-to-fit scaling');
{
  const pdf = printPage(`<!doctype html><meta charset="utf-8"><style>@page{size:684pt 864pt;margin:0}html,body{margin:0}.a{position:absolute;left:0;top:0;width:1200pt;height:100px;background:rgb(10,10,25)}</style><div class="a"></div>`, 'overflow');
  log('  overflowing body (no overflow:hidden): ' + contentOf(pdf).split('\n').filter((l) => / cm$/.test(l)).join(' | '));
  const pdf2 = printPage(`<!doctype html><meta charset="utf-8"><style>@page{size:684pt 864pt;margin:0}html,body{margin:0;overflow:hidden}.sheet{position:relative;width:684pt;height:864pt;overflow:hidden}.a{position:absolute;left:0;top:0;width:1200pt;height:100px;background:rgb(10,10,25)}</style><div class="sheet"><div class="a"></div></div>`, 'overflow2');
  log('  same content clipped by .sheet{overflow:hidden}: ' + contentOf(pdf2).split('\n').filter((l) => / cm$/.test(l)).join(' | ') + `   (pages: ${run('pdfinfo', [pdf2]).stdout.match(/Pages:\s+(\d+)/)?.[1]})`);
}

// ---- 2. snapping
log('\n## E2. geometry snapping: the same fractional-point boxes via CSS boxes vs inline SVG (numbers are CSS px; 1px = 0.75pt)');
{
  const pdf = P('build/exp-snap.pdf');
  const r = run('npx', ['electron', 'electron/main.cjs', '--page=experiments/snap.html', '--out=build/exp-snap.pdf']);
  if (r.status !== 0) throw new Error(r.stderr);
  const c = contentOf(pdf).split('\n');
  const res = c.filter((l) => / re$/.test(l) && !/^0 0 /.test(l));
  log('  wanted (pt): box 10.3,10.3 33.37x20.11 | rule 100.1,10.9 50x0.25 | border-top 0.25pt at 200,10 50 wide');
  log('  wanted (px): box 13.73,13.73 44.49x26.81 | rule 133.47,14.53 66.67x0.333 | border 266.67,13.33 66.67x0.333');
  log('  CSS boxes -> re ops : ' + res.slice(0, 4).join('  |  '));
  log('  inline SVG -> re/line ops : ' + res.filter((l) => /\./.test(l)).join('  |  ') + '  + stroked line (LW .3333)');
}

// ---- 3. fonts
log('\n## E3. font embedding matrix (Skia/Chromium -> PDF)');
const home = os.homedir();
const cands: { label: string; family: string; url: string; weight?: number }[] = [
  { label: 'Inter static, woff2 (TrueType outlines)', family: 'T1', url: P('fonts/Inter-Regular.woff2') },
  { label: 'Inter variable, woff2, wght=650', family: 'T2', url: P('fonts/InterVariable-wght.woff2'), weight: 650 },
  { label: 'Inter variable, TTF, wght=650', family: 'T3', url: P('fonts/InterVariable-wght.ttf'), weight: 650 },
  { label: 'Inter variable, TTF, wght=400 (default instance)', family: 'T4', url: P('fonts/InterVariable-wght.ttf'), weight: 400 },
  { label: 'Inter pinned to wght=650 with hb-subset (static TTF)', family: 'T5', url: P('fonts/Inter-wght650-instance.ttf') },
  { label: 'Alumni Sans variable TTF (user font library)', family: 'T6', url: `${home}/Library/Fonts/AlumniSans-VariableFont_wght.ttf`, weight: 650 },
  { label: 'Adobe Garamond Pro .otf (CFF, user font library)', family: 'T7', url: `${home}/Library/Fonts/AGaramondPro-Regular.otf` },
  { label: 'Noto Sans CJK .otf (CID-keyed CFF)', family: 'T8', url: '/Library/Fonts/RODE Noto Sans CJK SC R.otf' },
  { label: 'Georgia.ttf (system, static TTF)', family: 'T9', url: '/System/Library/Fonts/Supplemental/Georgia.ttf' },
  { label: 'Arial.ttf (system, static TTF)', family: 'T10', url: '/System/Library/Fonts/Supplemental/Arial.ttf' },
  { label: 'Barlow-Regular.ttf (user font library, static TTF)', family: 'T11', url: `${home}/Library/Fonts/Barlow-Regular.ttf` },
].filter((c) => fs.existsSync(c.url));
const faces = cands.map((c) => `@font-face{font-family:"${c.family}";font-weight:100 900;src:url("file://${c.url}")}`).join('\n');
const lines = cands.map((c, i) => `<div style="font-family:'${c.family}';font-weight:${c.weight ?? 400}">${i + 1}. ${c.label}</div>`).join('\n');
const fpdf = printPage(`<!doctype html><meta charset="utf-8"><style>@page{size:684pt 864pt;margin:0}html,body{margin:0;overflow:hidden}${faces}div{font-size:18pt;line-height:24pt;margin-left:20pt;color:rgb(10,10,25)}</style>${lines}`, 'fonts');
// one font per line: find the pdffonts rows grouped by distinct font object; map by rendering each line to its own page instead
const rows: string[] = [];
for (const [i, c] of cands.entries()) {
  const pdf = printPage(`<!doctype html><meta charset="utf-8"><style>@page{size:684pt 864pt;margin:0}html,body{margin:0;overflow:hidden}@font-face{font-family:"${c.family}";font-weight:100 900;src:url("file://${c.url}")}div{font-size:18pt;margin:20pt;color:rgb(10,10,25);font-family:"${c.family}";font-weight:${c.weight ?? 400}}</style><div>Hamburgefonstiv 0123</div>`, 'font1');
  const pf = run('pdffonts', [pdf]).stdout.split('\n').slice(2).filter((l) => l.trim());
  const types = [...new Set(pf.map((l) => l.replace(/\s{2,}/g, '|').split('|')[1]))];
  const names = [...new Set(pf.map((l) => l.split(/\s+/)[0]))];
  rows.push(`  ${String(i + 1).padStart(2)}. ${c.label.padEnd(56)} -> ${types.join(', ').padEnd(14)} ${pf.length} font obj(s)  ${names[0] ?? '(none: font did not load?)'}`);
}
for (const r of rows) log(r);
void fpdf;

// ---- 4. what does Skia emit for gradient variants, and can the prepress rewriter handle them?
log('\n## E4. gradient variants: what Skia emits and what the rewriter does (sentinel colours cyan/magenta/yellow/black)');
{
  const sent: any[] = JSON.parse(fs.readFileSync(P('build/sentinels.json'), 'utf8'));
  const c = (id: string) => { const r = sent.find((x) => x.id === id).rgb; return `rgb(${r.join(' ')})`; };
  const cy = c('cyan'), ma = c('magenta'), ye = c('yellow'), bk = c('black');
  const cases: [string, string][] = [
    ['linear, 2 stops', `linear-gradient(to right, ${cy}, ${ma})`],
    ['linear, 3 stops', `linear-gradient(to right, ${cy}, ${ye}, ${ma})`],
    ['linear, 5 stops', `linear-gradient(to right, ${cy}, ${ye} 20%, ${ma} 45%, ${bk} 70%, ${cy})`],
    ['linear, hard stops', `linear-gradient(to right, ${cy} 50%, ${ma} 50%)`],
    ['linear, colour hint (midpoint 25%)', `linear-gradient(to right, ${cy}, 25%, ${ma})`],
    ['linear, 45deg', `linear-gradient(45deg, ${cy}, ${ma})`],
    ['radial', `radial-gradient(circle, ${cy}, ${ma})`],
    ['conic', `conic-gradient(${cy}, ${ye}, ${ma}, ${cy})`],
    ['repeating-linear', `repeating-linear-gradient(to right, ${cy} 0 20px, ${ma} 20px 40px)`],
    ['linear, tiled via background-size', `linear-gradient(to right, ${cy}, ${ma}) 0 0 / 100px 60px repeat`],
    ['linear to transparent (same colour, alpha 0)', `linear-gradient(to right, rgb(from ${bk} r g b / 0), ${bk})`],
  ];
  const boxes = cases.map(([n, g], i) => `<div style="position:absolute;left:30pt;top:${20 + i * 60}pt;width:400pt;height:48pt;background:${g}" title="${n}"></div>`).join('\n');
  const gpdf = printPage(`<!doctype html><meta charset="utf-8"><style>@page{size:684pt 864pt;margin:0}html,body{margin:0;overflow:hidden}</style>${boxes}`, 'gradients');
  const r = run('npx', ['tsx', 'src/prepress/cli.ts', `--in=build/exp-gradients.pdf`, `--out=build/exp-out-gradients.pdf`]);
  const rep = JSON.parse(fs.readFileSync(P('build/exp-out-gradients.report.json'), 'utf8'));
  void gpdf; void r;
  log(`  ${cases.length} gradients in -> Chromium PDF has: shading types ${JSON.stringify(rep.shadings.shadingTypes)}, function types ${JSON.stringify(rep.shadings.functionTypes)}`);
  log(`  rewritten to CMYK: ${rep.shadings.rewritten}; unsupported: ${rep.shadings.unsupported.length}`);
  for (const u of rep.shadings.unsupported) log('    unsupported: ' + u);
  log(`  images emitted (rasterised gradients): ${rep.images.length} -> ${rep.images.map((i: any) => `${i.width}x${i.height} ${i.before}`).join('; ') || 'none'}`);
  log(`  leftover unmatched RGB: ${rep.unmatched.length}`);
  // classify each gradient from the raw Chromium PDF: follow the page's `/Pn scn` fills in paint order
  {
    const { PDFDocument, PDFName, PDFDict, PDFArray, PDFRawStream, PDFNumber } = await import('@cantoo/pdf-lib');
    const { parseContent } = await import('./prepress/tokenizer.ts');
    const { streamBytes, bytesToLatin1 } = await import('./prepress/pdfio.ts');
    const doc = await PDFDocument.load(fs.readFileSync(P('build/exp-gradients.pdf')));
    const ctx = doc.context;
    const page = doc.getPages()[0];
    const contents = ctx.lookup(page.node.get(PDFName.of('Contents'))) as any;
    const pats = ctx.lookup(page.node.Resources()!.get(PDFName.of('Pattern'))) as any;
    const order: string[] = [];
    for (const op of parseContent(bytesToLatin1(streamBytes(contents)))) if (op.operator === 'scn' && op.operands[0]?.kind === 'name' && op.operands[0].value.startsWith('P')) { if (!order.includes(op.operands[0].value)) order.push(op.operands[0].value); }
    const num = (o: any) => (o ? (ctx.lookup(o, PDFNumber) as any).asNumber() : undefined);
    const fnDesc = (f: any): string => {
      const fo: any = ctx.lookup(f);
      const d = fo instanceof PDFRawStream ? fo.dict : fo;
      const t = num(d.get(PDFName.of('FunctionType')));
      if (t === 3) { const fs_ = ctx.lookup(d.get(PDFName.of('Functions'))) as any; return `type 3 (${fs_.size()} sub-fns)`; }
      return `type ${t}${t === 4 ? ' PostScript' : ''}`;
    };
    log('  per gradient, in paint order:');
    order.forEach((name, i) => {
      const pd0: any = ctx.lookup(pats.get(PDFName.of(name)));
      const pd: any = pd0 instanceof PDFRawStream ? pd0.dict : pd0; // tiling patterns are streams
      const pt = num(pd.get(PDFName.of('PatternType')));
      let desc: string;
      if (pt === 2) { const sh: any = ctx.lookup(pd.get(PDFName.of('Shading'))); const st = num(sh.get(PDFName.of('ShadingType'))); desc = `shading pattern, ShadingType ${st}, function ${sh.get(PDFName.of('Function')) ? fnDesc(sh.get(PDFName.of('Function'))) : '-'}`; }
      else desc = `TILING pattern (PatternType 1): ${bytesToLatin1(streamBytes(pd0)).includes(' Do') ? 'contains an image XObject = rasterised by Skia' : 'vector content'}`;
      log(`    ${String(i + 1).padStart(2)}. ${cases[i]?.[0].padEnd(44)} -> ${desc}`);
    });
  }
}


// ---- 5. CSS feature matrix: what each feature turns into in the Chromium PDF, and whether the prepress step survives it
log('\n## E5. CSS feature matrix (sentinel colours in, prepress out)');
{
  const { PDFDocument, PDFName, PDFDict, PDFArray, PDFRawStream, PDFNumber } = await import('@cantoo/pdf-lib');
  const { scanRgb } = await import('./rgbscan.ts');
  const sent: any[] = JSON.parse(fs.readFileSync(P('build/sentinels.json'), 'utf8'));
  const c = (id: string) => { const r = sent.find((x) => x.id === id).rgb; return `rgb(${r.join(' ')})`; };
  const cy = c('cyan'), ma = c('magenta'), bk = c('black'), or = c('orange'), ye = c('yellow');
  const photo = 'file://' + P('assets/photo.jpg');
  const box = (extra: string, inner = '') => `<div style="position:absolute;left:60pt;top:60pt;width:240pt;height:120pt;background:${cy};${extra}">${inner}</div>`;
  const cases: [string, string, string][] = [
    ['solid box', box(''), 'C'],
    ['border-radius', box('border-radius:30px'), 'C'],
    ['rotate(8deg) box + text', box('transform:rotate(8deg);color:' + bk + ';font:20pt sans-serif', 'rotated text'), 'CK'],
    ['clip-path polygon', box('clip-path:polygon(0 0,100% 20%,80% 100%,0 80%)'), 'C'],
    ['opacity .5 group (box+text)', box('opacity:.5;color:' + bk + ';font:20pt sans-serif', 'text in group') + `<div style="position:absolute;left:150pt;top:100pt;width:200pt;height:100pt;background:${ma}"></div>`, 'CMK'],
    ['mix-blend-mode: multiply', box('') + `<div style="position:absolute;left:150pt;top:100pt;width:200pt;height:100pt;background:${ye};mix-blend-mode:multiply"></div>`, 'CY'],
    ['box-shadow (blur)', box(`box-shadow:6px 8px 12px ${bk}`), 'CK'],
    ['text-shadow (blur)', box('background:none;color:' + or + ';font:bold 40pt sans-serif;text-shadow:3px 3px 5px ' + bk, 'Shadow'), 'MYK'],
    ['filter: blur(3px)', box('filter:blur(3px)'), 'C'],
    ['mask-image: linear-gradient(black,transparent)', box('-webkit-mask-image:linear-gradient(black,transparent)'), 'C'],
    ['dashed border 2px', box(`background:none;border:2px dashed ${bk}`), 'K'],
    ['text stroke -webkit-text-stroke', box(`background:none;color:${or};-webkit-text-stroke:1.5px ${bk};font:bold 40pt sans-serif`, 'Stroke'), 'MYK'],
    ['gradient text (background-clip:text)', box(`background:linear-gradient(to right,${cy},${ma});-webkit-background-clip:text;color:transparent;font:bold 60pt sans-serif`, 'Grad'), 'CM'],
    ['SVG path + hairline stroke + linearGradient', `<svg style="position:absolute;left:60pt;top:60pt" width="300pt" height="150pt"><defs><linearGradient id="g"><stop offset="0" stop-color="${cy}"/><stop offset="1" stop-color="${ma}"/></linearGradient></defs><path d="M10 10 L200 30 L150 120 Z" fill="url(#g)" stroke="${bk}" stroke-width=".25pt"/></svg>`, 'CMK'],
    ['<img> opacity .5', `<img src="${photo}" style="position:absolute;left:60pt;top:60pt;width:240pt;height:160pt;opacity:.5">`, 'CMYK'],
    ['<img> rotated + border-radius', `<img src="${photo}" style="position:absolute;left:60pt;top:60pt;width:240pt;height:160pt;transform:rotate(6deg);border-radius:40px">`, 'CMYK'],
    ['<img> multiply over colour', `<div style="position:absolute;left:40pt;top:40pt;width:300pt;height:200pt;background:${or}"></div><img src="${photo}" style="position:absolute;left:60pt;top:60pt;width:240pt;height:160pt;mix-blend-mode:multiply">`, 'CMYK'],
  ];
  const results: string[] = [];
  for (const [label, body, inks] of cases) {
    const pdf = printPage(`<!doctype html><meta charset="utf-8"><style>@page{size:684pt 864pt;margin:0}html,body{margin:0;overflow:hidden}</style>${body}`, 'feat');
    // what Skia emitted
    const doc = await PDFDocument.load(fs.readFileSync(pdf));
    const ctx = doc.context;
    const imgs: string[] = []; let smaskGs = 0; const bms = new Set<string>(); const shT = new Set<number>(); let tiling = 0; const fontT = new Set<string>();
    for (const [, o] of ctx.enumerateIndirectObjects()) {
      const d: any = o instanceof PDFRawStream ? o.dict : o instanceof PDFDict ? o : undefined;
      if (!d) continue;
      const sub = d.get(PDFName.of('Subtype'))?.toString();
      if (sub === '/Image') imgs.push(`${(ctx.lookup(d.get(PDFName.of('Width'))) as any).asNumber()}x${(ctx.lookup(d.get(PDFName.of('Height'))) as any).asNumber()}${d.get(PDFName.of('SMask')) ? '+SMask' : ''}`);
      if (d.get(PDFName.of('SMask')) && d.get(PDFName.of('Type'))?.toString() === '/ExtGState') smaskGs++;
      const eg = ctx.lookup(d.get(PDFName.of('SMask')));
      if (eg instanceof PDFDict) smaskGs++;
      const bm = d.get(PDFName.of('BM'))?.toString(); if (bm && bm !== '/Normal') bms.add(bm.slice(1));
      if (d.get(PDFName.of('ShadingType'))) shT.add((ctx.lookup(d.get(PDFName.of('ShadingType'))) as any).asNumber());
      if (d.get(PDFName.of('PatternType'))?.toString() === '1') tiling++;
      if (sub === '/Type3') fontT.add('Type3'); if (sub === '/Type0') fontT.add('Type0/CID');
    }
    const emitted = [imgs.length ? `images ${imgs.join(',')}` : '', smaskGs ? `${smaskGs} soft mask` : '', bms.size ? `blend ${[...bms].join(',')}` : '', shT.size ? `shading ${[...shT].join(',')}` : '', tiling ? `${tiling} tiling pattern` : '', fontT.size ? `fonts ${[...fontT].join(',')}` : ''].filter(Boolean).join('; ') || 'vector paths only';
    // prepress
    const r = run('npx', ['tsx', 'src/prepress/cli.ts', '--in=build/exp-feat.pdf', '--out=build/exp-out-feat.pdf']);
    let verdict = 'prepress failed: ' + (r.stderr.split('\n').find((l) => /Error/.test(l)) ?? r.stderr.slice(0, 120));
    if (r.status === 0) {
      const rep = JSON.parse(fs.readFileSync(P('build/exp-out-feat.report.json'), 'utf8'));
      const sc = await scanRgb(P('build/exp-out-feat.pdf'));
      const problems: string[] = [];
      if (rep.unmatched.length) problems.push(`${rep.unmatched.length} unmatched RGB op(s)`);
      if (rep.shadings.unsupported.length) problems.push(`${rep.shadings.unsupported.length} unsupported shading fn(s)`);
      const unconv = rep.skippedImages.filter((x: string) => !/soft-mask data/.test(x));
      if (unconv.length) problems.push(`${unconv.length} raster(s) NOT converted`);
      if (sc.left.length) problems.push(`${sc.left.length} RGB leftover(s): ${[...new Set(sc.left.map((l) => l.what.replace(/\d+x\d+ /, '')))].join('; ')}`);
      const note = rep.images.map((i: any) => /flat exact/.test(i.after) ? 'raster recoloured flat' : /converted/.test(i.after) ? 'photo to CMYK' : '').filter(Boolean).join(', ');
      // measure plates with Ghostscript: ink must appear only on the expected process plates
      const sd = P('build/sep-feat'); fs.rmSync(sd, { recursive: true, force: true }); fs.mkdirSync(sd, { recursive: true });
      const g = run('gs', ['-q', '-dBATCH', '-dNOPAUSE', '-sDEVICE=tiffsep', '-r72', `-sOutputFile=${sd}/p%d.tif`, P('build/exp-out-feat.pdf')]);
      let inkNote = 'gs failed';
      if (g.status === 0) {
        const { readPlate, stats } = await import('./plates.ts');
        const mx: Record<string, number> = {};
        for (const [k, n] of Object.entries({ C: 'Cyan', M: 'Magenta', Y: 'Yellow', K: 'Black' })) { const pl = await readPlate(`${sd}/p1(${n}).tif`, n); mx[k] = stats(pl, { x: 40, y: 40, w: pl.w - 80, h: pl.h - 80 }).max; } // inside the trim box: skip the crop marks the prepress adds
        const bad = Object.keys(mx).filter((k) => !inks.includes(k) && mx[k] > 0.5);
        const missing = inks.split('').filter((k) => mx[k] < 5);
        inkNote = bad.length || missing.length ? `INK MISMATCH (expected ${inks}; stray ${bad.join('') || '-'}, absent ${missing.join('') || '-'}) max C${mx.C.toFixed(0)} M${mx.M.toFixed(0)} Y${mx.Y.toFixed(0)} K${mx.K.toFixed(0)}` : `ink only on ${inks}`;
        if (bad.length || missing.length) problems.push(inkNote);
      }
      verdict = problems.length ? 'PROBLEM: ' + problems.join(' | ') : `no RGB left, ${inkNote}` + (note ? ` (${note})` : '');
    }
    results.push(`  ${label.padEnd(46)} emitted: ${emitted.padEnd(52)} => ${verdict}`);
  }
  for (const r of results) log(r);
}

fs.mkdirSync(P('out'), { recursive: true });
fs.writeFileSync(P('out/experiments.txt'), out.join('\n') + '\n');
