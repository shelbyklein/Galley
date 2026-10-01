// One-off: static Inter TTFs (Regular/Italic/Bold/BoldItalic, latin subset) from @fontsource/inter woff2.
// Output is committed under fonts/ so nothing at runtime depends on node_modules.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const wawoff = require('wawoff2');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'node_modules/@fontsource/inter/files');
const out = path.join(root, 'fonts');
fs.mkdirSync(out, { recursive: true });
const map = {
  'Inter-Regular.ttf': 'inter-latin-400-normal.woff2',
  'Inter-Italic.ttf': 'inter-latin-400-italic.woff2',
  'Inter-Bold.ttf': 'inter-latin-700-normal.woff2',
  'Inter-BoldItalic.ttf': 'inter-latin-700-italic.woff2',
};
for (const [dst, s] of Object.entries(map)) {
  const ttf = await wawoff.decompress(fs.readFileSync(path.join(src, s)));
  fs.writeFileSync(path.join(out, dst), ttf);
  console.log(dst, ttf.length, 'bytes');
}
