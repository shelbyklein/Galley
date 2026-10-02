import fs from 'node:fs';
import path from 'node:path';
/** Only OFL npm fixtures. Files are generated into a temp package and never committed. */
export async function installOflFonts(packagePath: string): Promise<void> {
  const wawoff2 = require('wawoff2') as { decompress(bytes: Uint8Array): Promise<Uint8Array> };
  const fonts = path.join(packagePath, 'fonts');
  fs.mkdirSync(fonts, { recursive: true });
  for (const [source, name] of [
    ['@fontsource/inter/files/inter-latin-400-normal.woff2', 'Inter-Regular.ttf'],
    ['@fontsource-variable/roboto/files/roboto-latin-wght-normal.woff2', 'Roboto-Variable.ttf'],
  ]) fs.writeFileSync(path.join(fonts, name!), Buffer.from(await wawoff2.decompress(fs.readFileSync(require.resolve(source!)))));
}
