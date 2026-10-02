import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../helpers/launch';
import { installOflFonts } from './ofl-fixtures';
import type { FontFaceInfo } from '@galley/fonts/types';
export const specimen = 'Hamburg office affinity 0123456789 The quick brown fox jumps over the lazy dog. '.repeat(3).trim();
export async function buildFontFixture(packagePath: string, cff?: FontFaceInfo): Promise<void> {
  await installOflFonts(packagePath);
  const d = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'fixtures/poster-basic.galley/document.json'), 'utf8'));
  const baseFrame = d.frames.body;
  d.meta.title = 'Font export specimen'; d.assets = {}; d.frames = {}; d.stories = {};
  const page = d.pages.page_1;
  page.width = 612; page.height = 792; page.bleed = { top: 0, right: 0, bottom: 0, left: 0 }; page.slug = { top: 0, right: 0, bottom: 0, left: 0 }; page.items = [];
  const rows = [{ family: 'Inter', weight: 400, style: 'normal' }, { family: 'Roboto', weight: 650, style: 'normal' }, ...(cff ? [{ family: cff.family, weight: cff.weight, style: cff.style }] : [])];
  rows.forEach((font, i) => {
    const id = `font-${i}`, storyId = `story-${id}`; page.items.push(id);
    d.frames[id] = { ...baseFrame, id, storyId, x: 36, y: 36 + i * 200, w: 420, h: 170, inset: 0 };
    d.stories[storyId] = { id: storyId, frameIds: [id], doc: { type: 'doc', content: [{ type: 'paragraph', attrs: { style: 'basic-paragraph', overrides: { shared: { fontFamily: font.family, fontWeight: font.weight, fontStyle: font.style }, print: { fontSize: 18, leading: 24, hyphenate: false } } }, content: [{ type: 'text', text: specimen }] }] } };
  });
  fs.writeFileSync(path.join(packagePath, 'document.json'), JSON.stringify(d));
  fs.writeFileSync(path.join(packagePath, 'links.json'), '{"formatVersion":2,"links":{}}');
}
