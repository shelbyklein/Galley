// Bundles the renderer (browser IIFE) and the Electron main + preload (CJS) with esbuild.
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const common = { bundle: true, sourcemap: true, logLevel: 'warning', absWorkingDir: root };

await Promise.all([
  build({ ...common, entryPoints: ['src/renderer/main.ts'], outfile: 'build/renderer.js', format: 'iife', platform: 'browser', target: 'chrome140' }),
  build({ ...common, entryPoints: ['src/main/main.ts'], outfile: 'build/main.cjs', format: 'cjs', platform: 'node', external: ['electron'], target: 'node22' }),
  build({ ...common, entryPoints: ['src/main/preload.ts'], outfile: 'build/preload.cjs', format: 'cjs', platform: 'node', external: ['electron'], target: 'node22' }),
]);
console.log('built renderer.js, main.cjs, preload.cjs');
