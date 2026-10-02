import { describe, expect, it } from 'vitest';
import {
  createStory,
  documentSchema,
  DocumentParseError,
  frameSchema,
  inches,
  mm,
  paint,
  pageSchema,
  parseDocument,
  serializeDocument,
  swatchSchema,
  toInches,
  toMm,
  validateDocument,
  type GalleyDocument,
} from '../src';
import { baseDoc, imageAsset, rectFrame } from './helpers';

/** A document with one of everything, as raw JSON files, so tests can break it the way a bad file would be broken. */
function richDoc(): GalleyDocument {
  const doc = baseDoc();
  doc.assets.ast_1 = imageAsset('ast_1');
  doc.stories.sty_1 = createStory('sty_1', 'Hello\nWorld', { frameIds: ['t1'] });
  doc.frames = {
    r1: rectFrame('r1'),
    t1: { id: 't1', type: 'text', name: '', layerId: 'layer_1', x: 0, y: 0, w: 100, h: 50, rotation: 0, fill: null, stroke: null, storyId: 'sty_1', inset: 2 },
    i1: { id: 'i1', type: 'image', name: '', layerId: 'layer_1', x: 0, y: 0, w: 100, h: 50, rotation: 0, fill: null, stroke: null, assetId: 'ast_1', content: { x: 0, y: 0, w: 100, h: 50 } },
    g1: { id: 'g1', type: 'group', name: '', layerId: 'layer_1', childIds: ['r1'] },
  };
  doc.pages.page_1!.items = ['g1', 't1', 'i1'];
  doc.guides.gd_1 = { id: 'gd_1', orientation: 'horizontal', position: 489, pageId: 'page_1' };
  return doc;
}

function files(mutate: (doc: Record<string, any>, links: Record<string, any>) => void) {
  const f = serializeDocument(richDoc());
  const doc = JSON.parse(f.document);
  const links = JSON.parse(f.links);
  mutate(doc, links);
  return { document: JSON.stringify(doc), links: JSON.stringify(links) };
}

describe('schema: units', () => {
  it('accepts points and rejects strings with units, NaN and Infinity', () => {
    const ok = rectFrame('r1');
    expect(frameSchema.safeParse(ok).success).toBe(true);
    for (const bad of ['36pt', '0.5in', '12mm', NaN, Infinity, null]) {
      expect(frameSchema.safeParse({ ...ok, x: bad }).success, `x = ${String(bad)}`).toBe(false);
    }
  });

  it('rejects negative sizes, zero page sizes and out-of-range percentages', () => {
    const ok = rectFrame('r1');
    expect(frameSchema.safeParse({ ...ok, w: -1 }).success).toBe(false);
    expect(frameSchema.safeParse({ ...ok, stroke: { paint: paint('black'), weight: -2 } }).success).toBe(false);
    expect(frameSchema.safeParse({ ...ok, fill: paint('black', 101) }).success).toBe(false);
    expect(swatchSchema.safeParse({ id: 'c', name: 'C', type: 'cmyk', values: [0, 0, 0, 120] }).success).toBe(false);
    const page = baseDoc().pages.page_1!;
    expect(pageSchema.safeParse({ ...page, width: 0 }).success).toBe(false);
    expect(pageSchema.safeParse({ ...page, width: '8.5in' }).success).toBe(false);
    expect(pageSchema.safeParse({ ...page, margins: { top: 0, right: 400, bottom: 0, left: 300 } }).success).toBe(false);
  });

  it('rejects unknown keys and bad ids', () => {
    expect(frameSchema.safeParse({ ...rectFrame('r1'), units: 'mm' }).success).toBe(false);
    expect(frameSchema.safeParse({ ...rectFrame('bad id!') }).success).toBe(false);
  });

  it('rejects a document file that stores a unit string', () => {
    const f = files((doc) => {
      doc.frames.r1.x = '36pt';
    });
    expect(() => parseDocument(f)).toThrow(DocumentParseError);
    expect(() => parseDocument(f)).toThrow(/frames\.r1\.x/);
  });

  it('converts display units at the edge', () => {
    expect(inches(11)).toBe(792);
    expect(mm(25.4)).toBeCloseTo(72, 10);
    expect(toInches(36)).toBe(0.5);
    expect(toMm(72)).toBeCloseTo(25.4, 10);
  });
});

describe('schema: dangling ids and structure', () => {
  it('the rich fixture document is valid', () => {
    expect(documentSchema.safeParse(richDoc()).success).toBe(true);
    expect(validateDocument(richDoc())).toEqual([]);
    expect(parseDocument(serializeDocument(richDoc()))).toEqual(richDoc());
  });

  const cases: [string, (doc: Record<string, any>, links: Record<string, any>) => void, RegExp][] = [
    ['a frame on a missing layer', (d) => (d.frames.r1.layerId = 'ghost'), /layerId.*ghost/],
    ['a page item that is not a frame', (d) => d.pages.page_1.items.push('ghost'), /ghost.*not an existing frame/],
    ['a group child that is not a frame', (d) => d.frames.g1.childIds.push('ghost'), /ghost/],
    ['a fill with a missing swatch', (d) => (d.frames.r1.fill.swatchId = 'ghost'), /swatch "ghost"/],
    ['a stroke with a missing swatch', (d) => (d.frames.r1.stroke = { paint: { swatchId: 'ghost', tint: 100, overprint: false }, weight: 1 }), /swatch "ghost"/],
    ['a text frame with a missing story', (d) => (d.frames.t1.storyId = 'ghost'), /story "ghost"/],
    ['an image frame with a missing asset', (d) => (d.frames.i1.assetId = 'ghost'), /asset "ghost"/],
    ['a tint swatch with a missing base', (d) => (d.swatches['spot185-40'].baseId = 'ghost'), /base swatch "ghost"/],
    ['a guide on a missing page', (d) => (d.guides.gd_1.pageId = 'ghost'), /page "ghost"/],
    ['a paragraph style color with a missing swatch', (d) => (d.paragraphStyles['basic-paragraph'].shared.fill.swatchId = 'ghost'), /swatch "ghost"/],
    ['a paragraph with a missing style', (d) => (d.stories.sty_1.doc.content[0].attrs.style = 'ghost'), /paragraph style "ghost"/],
    ['a style based on a missing style', (d) => ((d.paragraphStyles.x = { id: 'x', name: 'X', basedOn: 'ghost', shared: {}, print: {}, web: {} }), d.paragraphStyleOrder.push('x')), /style "ghost" does not exist/],
    ['a style based on itself', (d) => ((d.paragraphStyles.x = { id: 'x', name: 'X', basedOn: 'x', shared: {}, print: {}, web: {} }), d.paragraphStyleOrder.push('x')), /based on itself/],
    ['a style cycle through two styles', (d) => ((d.paragraphStyles.x = { id: 'x', name: 'X', basedOn: 'y', shared: {}, print: {}, web: {} }), (d.paragraphStyles.y = { id: 'y', name: 'Y', basedOn: 'x', shared: {}, print: {}, web: {} }), d.paragraphStyleOrder.push('x', 'y')), /based on itself/],
    ['a missing built-in paragraph style', (d) => (delete d.paragraphStyles['basic-paragraph'], (d.paragraphStyleOrder = [])), /basic-paragraph|Basic Paragraph/],
    ['a bad frame text wrap', (d) => (d.frames.r1.textWrap = { mode: 'contour', offset: -3 }), /textWrap/],
    ['a bad baseline grid', (d) => (d.baselineGrid.increment = 0), /baselineGrid/],
    ['a page order naming a missing page', (d) => d.pageOrder.push('ghost'), /ghost/],
    ['a layer order missing a layer', (d) => (d.layerOrder = []), /at least one layer|missing from the order/],
    ['an asset without a link', (_d, l) => delete l.links.ast_1, /no entry in links\.json/],
    ['a link for an unknown asset', (_d, l) => (l.links.ghost = { path: 'assets/x.jpg', hash: `sha256:${'b'.repeat(64)}` }), /unknown asset "ghost"/],
    ['a frame listed twice', (d) => d.pages.page_1.items.push('t1'), /also listed/],
    ['a frame on no page', (d) => (d.pages.page_1.items = ['g1', 't1']), /not on any page/],
    ['a record key that does not match the id', (d) => (d.frames.r1.id = 'other'), /does not match/],
    ['two swatches with one name', (d) => (d.swatches.orange.name = 'PANTONE 185 C'), /already used/],
    ['a tint of a tint', (d) => (d.swatches['spot185-40'].baseId = 'orange') && (d.swatches.orange = { id: 'orange', name: 'Orange', type: 'tint', baseId: 'spot185-40', percent: 10 }), /another tint/],
    ['a group inside itself', (d) => (d.frames.g1.childIds = ['g1']), /contains itself|also listed/],
    ['an unused story', (d) => (d.stories.extra = { ...d.stories.sty_1, id: 'extra', frameIds: [] }), /not used by any text frame/],
    ['a text frame its story does not list', (d) => ((d.frames.t2 = { ...d.frames.t1, id: 't2' }), d.pages.page_1.items.push('t2')), /does not list this frame exactly once/],
    ['a thread naming a frame that is not a text frame', (d) => d.stories.sty_1.frameIds.push('r1'), /not a text frame/],
    ['a thread listing a frame twice', (d) => d.stories.sty_1.frameIds.push('t1'), /listed twice|exactly once/],
    ['a thread naming a missing frame', (d) => d.stories.sty_1.frameIds.push('ghost'), /ghost/],
    ['a child on a different layer than its group', (d) => ((d.layers.l2 = { id: 'l2', name: 'L2', color: '#112233', visible: true, locked: false }), d.layerOrder.push('l2'), (d.frames.r1.layerId = 'l2')), /different layer/],
    ['an image frame with an asset but no content', (d) => (d.frames.i1.content = null), /both be set or both be null/],
  ];
  for (const [name, mutate, message] of cases) {
    it(`rejects ${name}`, () => {
      expect(() => parseDocument(files(mutate))).toThrow(message);
    });
  }

  it('rejects a path that escapes the package', () => {
    for (const path of ['../secret.jpg', '/etc/passwd', 'assets\\x.jpg', 'assets//x.jpg', 'C:/x.jpg']) {
      const f = files((_d, l) => (l.links.ast_1.path = path));
      expect(() => parseDocument(f), path).toThrow(DocumentParseError);
    }
  });
});
