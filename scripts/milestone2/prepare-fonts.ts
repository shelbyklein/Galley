// The flyer fixture uses only OFL fonts installed as npm dependencies. No machine fonts are copied or committed.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(path.join(process.cwd(), 'package.json'));
const woff2 = require('wawoff2') as { decompress(bytes: Uint8Array): Promise<Uint8Array> };
async function main() {
const pkg = process.argv[2];
if (!pkg) throw new Error('usage: prepare-fonts <blank .galley package>');
const directory = path.join(pkg, 'fonts');
fs.mkdirSync(directory, { recursive: true });
for (const [source, name] of [
  ['@fontsource/inter/files/inter-latin-400-normal.woff2', 'Inter-Regular.ttf'],
  ['@fontsource-variable/roboto/files/roboto-latin-wght-normal.woff2', 'Roboto-Variable.ttf'],
] as const) {
  fs.writeFileSync(path.join(directory, name), Buffer.from(await woff2.decompress(fs.readFileSync(require.resolve(source)))));
}
console.log(JSON.stringify({ staticFamily: 'Inter', variableFamily: 'Roboto', directory }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
