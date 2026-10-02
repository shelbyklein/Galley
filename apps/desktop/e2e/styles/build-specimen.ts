import { addFrame, addStyle, applyCommand, applyParagraphStyle, createDocument, createHistory, createStory, serializeDocument, wholeStory } from '@galley/model';
import fs from 'node:fs';
import path from 'node:path';
/** Deterministic OFL Inter-only specimen. Regenerate: npx tsx apps/desktop/e2e/styles/build-specimen.ts */
let h = createHistory(createDocument({ title: 'Type specimen', engineVersion: '44.5.1', page: { id: 'page_1' }, layer: { id: 'layer_1' } }));
h = applyCommand(h, addStyle, { kind: 'paragraph', style: { id: 'body-first', name: 'Body First', basedOn: 'basic-paragraph', shared: { fontFamily: 'Inter' }, print: { fontSize: 10, leading: 13.5 }, web: { fontSize: '1rem', lineHeight: '1.5', tag: 'p' } } });
h = applyCommand(h, addStyle, { kind: 'paragraph', style: { id: 'body', name: 'Body', basedOn: 'body-first', shared: {}, print: {}, web: {} } });
for (const [id, y, text] of [['a', 60, 'Alphabet typography gives the page a clear voice.\nParagraph spacing creates rhythm for readers. This specimen uses Inter only, with editable styles and precise leading.'], ['b', 330, 'A second use follows the same Body style. Changes to its definition update every use.']] as const) {
 const story = createStory(`story_${id}`, text);
 h = applyCommand(h, addFrame, { pageId: 'page_1', frame: { id, type: 'text', name: '', layerId: 'layer_1', x: 54, y, w: 320, h: 180, rotation: 0, fill: null, stroke: null, storyId: story.id, inset: 0 }, story });
 h = applyCommand(h, applyParagraphStyle, { storyId: story.id, range: wholeStory(story.doc), styleId: 'body' });
}
const serialized = serializeDocument(h.doc);
const directory = path.join(__dirname, 'fixtures', 'type-specimen.galley');
fs.mkdirSync(directory, { recursive: true });
fs.writeFileSync(path.join(directory, 'document.json'), serialized.document);
fs.writeFileSync(path.join(directory, 'links.json'), serialized.links);
console.log(directory);
