/**
 * Generates fixtures/poster-basic.galley/assets/photo.jpg: a procedural landscape (sky, clouds, sun, two hills) with
 * film grain, 2400 x 1280 px (1.875:1, the poster's 720 x 384 pt photo frame), tagged 300 ppi and sRGB.
 *
 * The image is made entirely by this script from shapes and seeded noise, so it has no third-party source and no
 * license to track. It is deterministic: the same script gives the same pixels. Run:
 *   npx tsx scripts/fixtures/generate-photo.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

export const PHOTO_WIDTH = 2400;
export const PHOTO_HEIGHT = 1280;

const OUT = path.resolve(__dirname, '../../fixtures/poster-basic.galley/assets/photo.jpg');

/** mulberry32 */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${PHOTO_WIDTH}" height="${PHOTO_HEIGHT}" viewBox="0 0 411 219.2">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#4f7fc4"/>
      <stop offset="0.65" stop-color="#8fb3e0"/>
      <stop offset="1" stop-color="#cfe0f3"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#fff2c4" stop-opacity="0.95"/>
      <stop offset="1" stop-color="#fff2c4" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="red" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#c2303a"/>
      <stop offset="1" stop-color="#8f1d27"/>
    </linearGradient>
    <linearGradient id="green" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#3d8244"/>
      <stop offset="1" stop-color="#245428"/>
    </linearGradient>
    <filter id="soft" x="-20%" y="-60%" width="140%" height="220%"><feGaussianBlur stdDeviation="3.2"/></filter>
    <filter id="softer" x="-20%" y="-60%" width="140%" height="220%"><feGaussianBlur stdDeviation="6"/></filter>
  </defs>
  <rect width="411" height="219.2" fill="url(#sky)"/>
  <circle cx="306" cy="80" r="62" fill="url(#glow)"/>
  <circle cx="306" cy="80" r="29" fill="#f6d27a"/>
  <g fill="#ffffff" filter="url(#soft)" opacity="0.85">
    <ellipse cx="86" cy="52" rx="42" ry="8"/><ellipse cx="108" cy="46" rx="26" ry="8"/>
    <ellipse cx="205" cy="34" rx="50" ry="7"/><ellipse cx="228" cy="29" rx="28" ry="6.5"/>
  </g>
  <g fill="#ffffff" filter="url(#softer)" opacity="0.6">
    <ellipse cx="350" cy="30" rx="48" ry="6"/><ellipse cx="20" cy="86" rx="40" ry="6"/>
  </g>
  <path d="M0 140 C 74 100 164 110 244 128 S 374 140 411 120 V 219.2 H 0 Z" fill="url(#red)"/>
  <path d="M0 180 C 84 160 204 170 304 180 S 394 176 411 170 V 219.2 H 0 Z" fill="url(#green)"/>
  <g stroke="#1d4a21" stroke-opacity="0.35" stroke-width="0.35" fill="none">
    <path d="M10 196 C 60 188 120 192 170 190"/><path d="M200 200 C 250 192 320 196 380 192"/><path d="M60 210 C 120 204 200 206 260 204"/>
  </g>
</svg>`;

async function main() {
  const { data, info } = await sharp(Buffer.from(svg)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const rand = prng(20261001);
  // film grain: sum of two uniforms (a rough bell), luminance-weighted a little toward the shadows
  for (let i = 0; i < data.length; i += 3) {
    const g = (rand() + rand() - 1) * 7;
    for (let c = 0; c < 3; c++) data[i + c] = Math.max(0, Math.min(255, Math.round(data[i + c]! + g + (rand() - 0.5) * 1.5)));
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  await sharp(data, { raw: { width: info.width, height: info.height, channels: 3 } })
    .withIccProfile('srgb')
    .withMetadata({ density: 300 })
    .jpeg({ quality: 78, chromaSubsampling: '4:2:0', mozjpeg: false })
    .toFile(OUT);
  const stat = fs.statSync(OUT);
  console.log(`wrote ${path.relative(process.cwd(), OUT)} (${info.width} x ${info.height}, ${(stat.size / 1024).toFixed(0)} KB)`);
}

void main();
