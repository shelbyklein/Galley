import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
const common = { bundle:true,sourcemap:true,logLevel:'warning',absWorkingDir:root };
await Promise.all([
 build({...common,entryPoints:['renderer.ts'],outfile:'build/renderer.js',format:'iife',platform:'browser',target:'chrome152'}),
 build({...common,entryPoints:['main.ts'],outfile:'build/main.cjs',format:'cjs',platform:'node',external:['electron'],target:'node22'}),
 build({...common,entryPoints:['preload.ts'],outfile:'build/preload.cjs',format:'cjs',platform:'node',external:['electron'],target:'node22'})
]);
