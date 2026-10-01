// Generates the test photo and copies the font files the page loads via @font-face.
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fonts = path.join(root, 'fonts');
const assets = path.join(root, 'assets');
fs.mkdirSync(fonts, { recursive: true });
fs.mkdirSync(assets, { recursive: true });

const cp = (from: string, to: string) => fs.copyFileSync(path.join(root, 'node_modules', from), path.join(fonts, to));
cp('@fontsource/inter/files/inter-latin-400-normal.woff2', 'Inter-Regular.woff2');
cp('@fontsource/inter/files/inter-latin-800-normal.woff2', 'Inter-ExtraBold.woff2');
cp('@fontsource-variable/inter/files/inter-latin-wght-normal.woff2', 'InterVariable-wght.woff2');

// "Photo": a synthetic landscape with smooth gradients, saturated shapes, blur and grain,
// saved as an sRGB JPEG with an embedded sRGB ICC profile (what a camera/phone JPEG would carry).
const W = 1800, H = 1200;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1b4f9c"/><stop offset="0.55" stop-color="#7fb8e8"/><stop offset="1" stop-color="#ffd9a0"/>
    </linearGradient>
    <radialGradient id="sun" cx="0.72" cy="0.62" r="0.22">
      <stop offset="0" stop-color="#fff7c2"/><stop offset="0.4" stop-color="#ffb347" stop-opacity="0.9"/><stop offset="1" stop-color="#ff6a3d" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="hill1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1f7a4a"/><stop offset="1" stop-color="#0b3d2a"/></linearGradient>
    <linearGradient id="hill2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c0392b"/><stop offset="1" stop-color="#6e1f17"/></linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#sky)"/>
  <rect width="${W}" height="${H}" fill="url(#sun)"/>
  <path d="M0 760 C300 600 520 700 820 650 S1400 560 1800 700 L1800 1200 L0 1200Z" fill="url(#hill2)"/>
  <path d="M0 900 C260 780 600 880 900 820 S1500 760 1800 880 L1800 1200 L0 1200Z" fill="url(#hill1)"/>
  <circle cx="300" cy="260" r="70" fill="#ffffff" fill-opacity="0.85"/>
  <circle cx="380" cy="250" r="55" fill="#ffffff" fill-opacity="0.8"/>
  <rect x="1180" y="930" width="220" height="120" fill="#ffd400"/>
  <rect x="1230" y="980" width="60" height="70" fill="#00a6d6"/>
</svg>`;

const base = await sharp(Buffer.from(svg)).blur(1.2).toBuffer();
const grain = await sharp({ create: { width: W, height: H, channels: 3, noise: { type: 'gaussian', mean: 128, sigma: 18 } } } as any).png().toBuffer();
await sharp(base)
  .composite([{ input: grain, blend: 'overlay' }])
  .withIccProfile('srgb')
  .jpeg({ quality: 90, chromaSubsampling: '4:4:4' })
  .toFile(path.join(assets, 'photo.jpg'));

const meta = await sharp(path.join(assets, 'photo.jpg')).metadata();
console.log(`photo.jpg ${meta.width}x${meta.height} ${meta.space} icc=${!!meta.icc}`);
console.log('fonts:', fs.readdirSync(fonts).join(', '));

// Static instance of the variable font (the PLAN's fallback for "variable fonts come out as Type 3").
// woff2 -> ttf with wawoff2, then HarfBuzz hb-subset pins wght=650 and keeps everything else.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const wawoff2 = require('wawoff2');
const vfTtf = path.join(fonts, 'InterVariable-wght.ttf');
fs.writeFileSync(vfTtf, Buffer.from(await wawoff2.decompress(fs.readFileSync(path.join(fonts, 'InterVariable-wght.woff2')))));
const inst = path.join(fonts, 'Inter-wght650-instance.ttf');
try {
  execFileSync('hb-subset', [vfTtf, '--unicodes=*', '--keep-everything', '--variations=wght=650', '-o', inst], { stdio: 'pipe' });
  console.log('instance:', path.basename(inst), fs.statSync(inst).size, 'bytes');
} catch (e) {
  console.log('hb-subset not available; static-instance test skipped');
}
