// CLI: tsx src/prepress/cli.ts [--photo=cmyk|rgb-icc] [--in build/chromium.pdf] [--out out/galley-press-spike.pdf]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepress } from './index.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const arg = (name: string, dflt: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? dflt;

const input = path.resolve(root, arg('in', 'build/chromium.pdf'));
const output = path.resolve(root, arg('out', 'out/galley-press-spike.pdf'));
const photoMode = arg('photo', 'cmyk') as 'cmyk' | 'rgb-icc';

const GRACOL = '/Library/Application Support/Adobe/Color/Profiles/Recommended/CoatedGRACoL2006.icc';
const SRGB = '/System/Library/ColorSync/Profiles/sRGB Profile.icc';
for (const f of [input, GRACOL, SRGB]) if (!fs.existsSync(f)) { console.error(`missing ${f}`); process.exit(1); }

const sentinels = JSON.parse(fs.readFileSync(path.join(root, 'build/sentinels.json'), 'utf8'));
const geom = JSON.parse(fs.readFileSync(path.join(root, 'geometry.json'), 'utf8'));
const pt = (inch: number) => inch * 72;
const margin = pt(geom.marginIn); // slug room beyond trim
const trimW = pt(geom.trimIn[0]), trimH = pt(geom.trimIn[1]);

const { bytes, report } = await prepress(fs.readFileSync(input), {
  sentinels,
  geometry: { pageW: trimW + 2 * margin, pageH: trimH + 2 * margin, trim: [margin, margin, margin + trimW, margin + trimH], bleed: pt(geom.bleedIn) },
  outputIntent: {
    profilePath: GRACOL,
    identifier: 'CGATS TR 006',
    condition: 'Coated GRACoL 2006 (ISO 12647-2:2004)',
    registry: 'http://www.color.org',
    info: 'Coated GRACoL 2006 (ISO 12647-2:2004), sheetfed offset, coated paper',
  },
  photoMode,
  srgbProfilePath: SRGB,
  title: 'Galley press spike',
  marks: true,
});
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, bytes);
fs.writeFileSync(output.replace(/\.pdf$/, '.report.json'), JSON.stringify(report, null, 2));

const t = report.totals;
console.log(`prepress: ${path.relative(root, input)} (${fs.statSync(input).size} B) -> ${path.relative(root, output)} (${bytes.length} B), photo=${photoMode}`);
console.log(`  RGB colour ops seen: ${t.rgbOps}  -> CMYK: ${t.cmykOut}, spot: ${t.spotOut}, default black->K: ${t.defaultBlack}, default white->paper: ${t.defaultWhite}`);
console.log(`  sentinel hits: ${JSON.stringify(t.sentinelHits)}  (max rounding error ${t.maxRoundingError.toFixed(4)} /255)`);
console.log(`  overprint toggles inserted: ${t.overprintToggles}`);
console.log(`  shadings rewritten: ${report.shadings.rewritten} (shading types ${JSON.stringify(report.shadings.shadingTypes)}, function types ${JSON.stringify(report.shadings.functionTypes)})`);
console.log(`  transparency groups: ${JSON.stringify(report.groups)}`);
console.log(`  images: ${JSON.stringify(report.images)}`);
if (report.shadings.unsupported.length) console.log('  UNSUPPORTED shadings:', report.shadings.unsupported);
if (report.unmatched.length) console.log('  UNMATCHED RGB colours:', report.unmatched);
if (report.unhandled.length) console.log('  UNHANDLED colour ops:', report.unhandled);
if (report.skippedImages.length) console.log('  skipped images:', report.skippedImages);
