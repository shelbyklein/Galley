import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BASIC_PARAGRAPH_ID,
  bolderWeight,
  describeTextAttrs,
  DocumentParseError,
  migrateV1ToV2,
  paragraphAttrs,
  parseDocument,
  resolveParagraph,
  resolveRun,
  serializeDocument,
  validateDocument,
  type GalleyDocument,
  type PMNode,
} from '../src';

const V1_DIR = fileURLToPath(new URL('../../../fixtures/v1/', import.meta.url));
const FIXTURES = fs.readdirSync(V1_DIR).filter((n) => n.endsWith('.galley')).sort();

const read = (name: string, file: string) => fs.readFileSync(`${V1_DIR}${name}/${file}`, 'utf8');
const v1Files = (name: string) => ({ document: read(name, 'document.json'), links: read(name, 'links.json') });

/** What a v1 renderer drew a run with: the story default, `bolder` for strong, italic for em. */
function v1Look(defaults: Record<string, any>, marks: string[]) {
  return {
    fontFamily: defaults.fontFamily,
    fontWeight: marks.includes('strong') ? bolderWeight(defaults.fontWeight) : defaults.fontWeight,
    fontStyle: marks.includes('em') ? 'italic' : defaults.fontStyle,
    fontSize: defaults.fontSize,
    leading: defaults.leading,
    tracking: defaults.tracking,
    align: defaults.align,
    fill: defaults.fill,
  };
}
const pick = (r: Record<string, any>) => ({ fontFamily: r.fontFamily, fontWeight: r.fontWeight, fontStyle: r.fontStyle, fontSize: r.fontSize, leading: r.leading, tracking: r.tracking, align: r.align, fill: r.fill });

describe('the v1 fixtures migrate to v2', () => {
  it('there are v1 fixtures to migrate, and they really are formatVersion 1', () => {
    expect(FIXTURES).toEqual(['poster-basic.galley', 'swatch-chart.galley', 'typography-marks.galley']);
    for (const name of FIXTURES) {
      expect(JSON.parse(read(name, 'document.json')).formatVersion, name).toBe(1);
      expect(JSON.parse(read(name, 'links.json')).formatVersion, name).toBe(1);
    }
  });

  for (const name of FIXTURES) {
    describe(name, () => {
      const raw = JSON.parse(read(name, 'document.json'));
      const doc: GalleyDocument = parseDocument(v1Files(name));

      it('parses to a valid current-format document with the same frames, text and swatches', () => {
        expect(doc.formatVersion).toBe(2);
        expect(validateDocument(doc)).toEqual([]);
        expect(doc.frames).toEqual(raw.frames);
        expect(doc.swatches).toEqual(raw.swatches);
        expect(doc.pages).toEqual(raw.pages);
        expect(doc.assets).toEqual(parseDocument(v1Files(name)).assets);
        expect(Object.keys(doc.stories).sort()).toEqual(Object.keys(raw.stories).sort());
        expect(doc.baselineGrid).toEqual({ start: 0, increment: 12 });
        for (const [id, story] of Object.entries<any>(raw.stories)) {
          const migrated = doc.stories[id]!;
          const text = (n: PMNode) => (n.content ?? []).map((p) => (p.content ?? []).map((t) => t.text ?? '').join('')).join('\n');
          expect(text(migrated.doc), id).toBe(text(story.doc));
          expect(migrated.frameIds, id).toEqual(Object.values<any>(raw.frames).filter((f) => f.type === 'text' && f.storyId === id).map((f) => f.id).sort());
        }
      });

      it('every paragraph and every run resolves to exactly what the v1 renderer drew', () => {
        for (const [id, story] of Object.entries<any>(raw.stories)) {
          const migrated = doc.stories[id]!;
          story.doc.content.forEach((v1p: any, i: number) => {
            const p = migrated.doc.content![i]!;
            const paragraph = resolveParagraph(doc, paragraphAttrs(p));
            expect(pick(paragraph), `${id} paragraph ${i}`).toEqual(pick(v1Look(story.defaults, [])));
            // everything v2 added resolves to a no-op for v1 text
            expect(paragraph).toMatchObject({ firstLineIndent: 0, leftIndent: 0, rightIndent: 0, spaceBefore: 0, spaceAfter: 0, hyphenate: true, kerning: 'metrics', textCase: 'normal', features: {}, baselineShift: 0, dropCapLines: 0, alignToBaselineGrid: false });
            // the runs, split where the marks change (the migration merges runs whose marks became identical)
            const expected: [string, any][] = [];
            for (const t of v1p.content ?? []) {
              const look = v1Look(story.defaults, (t.marks ?? []).map((m: any) => m.type));
              const last = expected[expected.length - 1];
              if (last && JSON.stringify(last[1]) === JSON.stringify(look)) last[0] += t.text;
              else expected.push([t.text, look]);
            }
            const actual = (p.content ?? []).map((t): [string, any] => [t.text!, pick(resolveRun(doc, paragraph, t.marks))]);
            expect(actual, `${id} paragraph ${i} runs`).toEqual(expected);
          });
        }
      });

      it('serializes to formatVersion 2 files that parse back to the same document', () => {
        const files = serializeDocument(doc);
        expect(JSON.parse(files.document).formatVersion).toBe(2);
        expect(JSON.parse(files.links).formatVersion).toBe(2);
        expect(parseDocument(files)).toEqual(doc);
        // saving is stable: parsing and serializing again changes nothing
        expect(serializeDocument(parseDocument(files))).toEqual(files);
      });

      it('is deterministic: key order in the v1 file does not change the result', () => {
        const reversed = (v: any): any => (Array.isArray(v) ? v.map(reversed) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).reverse().map((k) => [k, reversed(v[k])])) : v);
        expect(serializeDocument(parseDocument({ document: JSON.stringify(reversed(raw)), links: read(name, 'links.json') }))).toEqual(serializeDocument(doc));
      });
    });
  }

  it('the poster gets one style per distinct set of defaults, none for text that is already [Basic Paragraph], named by what it sets', () => {
    const doc = parseDocument(v1Files('poster-basic.galley'));
    expect(doc.paragraphStyleOrder[0]).toBe(BASIC_PARAGRAPH_ID);
    const imported = doc.paragraphStyleOrder.slice(1).map((id) => doc.paragraphStyles[id]!);
    // styles are created in story id order: body, details, free, open-studio, spring, url
    expect(imported.map((s) => s.name)).toEqual(['Inter Regular 18/27', 'Inter Regular 22.5/27', 'Inter Black 37.5/39', 'Inter ExtraBold 70/75', 'Inter ExtraBold 160/168', 'Inter Bold 18/27']);
    expect(imported.map((s) => s.id)).toEqual(['imported-1', 'imported-2', 'imported-3', 'imported-4', 'imported-5', 'imported-6']);
    for (const s of imported) expect(s.basedOn).toBe(BASIC_PARAGRAPH_ID);
    expect(imported[4]).toMatchObject({ shared: { fontFamily: 'Inter', fontWeight: 800, fontStyle: 'normal', tracking: -20, fill: { swatchId: 'studio-blue', tint: 100, overprint: false } }, print: { fontSize: 160, leading: 168, align: 'left' }, web: {} });
  });
});

describe('migrateV1ToV2 on small documents', () => {
  const swatches = {
    black: { id: 'black', name: '[Black]', type: 'cmyk', values: [0, 0, 0, 100] },
    paper: { id: 'paper', name: '[Paper]', type: 'cmyk', values: [0, 0, 0, 0] },
    registration: { id: 'registration', name: '[Registration]', type: 'cmyk', values: [100, 100, 100, 100] },
    red: { id: 'red', name: 'Red', type: 'cmyk', values: [0, 100, 100, 0] },
  };
  const defaults = (extra: object = {}) => ({ fontFamily: 'Inter', fontWeight: 400, fontStyle: 'normal', fontSize: 12, leading: 15, tracking: 0, align: 'left', fill: { swatchId: 'black', tint: 100, overprint: false }, ...extra });
  const v1 = (stories: Record<string, any>, frames: Record<string, any> = {}) => ({
    formatVersion: 1,
    meta: { title: 'T', engineVersion: '44.5.1', colorProfile: null },
    pageOrder: ['p'],
    pages: { p: { id: 'p', width: 612, height: 792, margins: { top: 36, right: 36, bottom: 36, left: 36 }, columns: { count: 1, gutter: 12 }, bleed: { top: 0, right: 0, bottom: 0, left: 0 }, slug: { top: 0, right: 0, bottom: 0, left: 0 }, items: Object.keys(frames) } },
    layerOrder: ['l'],
    layers: { l: { id: 'l', name: 'Layer 1', color: '#4da3ff', visible: true, locked: false } },
    swatchOrder: ['registration', 'paper', 'black', 'red'],
    swatches,
    frames,
    stories,
    assets: {},
    guides: {},
  });
  const textFrame = (id: string, storyId: string) => ({ id, type: 'text', name: '', layerId: 'l', x: 0, y: 0, w: 100, h: 50, rotation: 0, fill: null, stroke: null, storyId, inset: 0 });
  const story = (id: string, d: object, ...paragraphs: any[]) => ({ id, defaults: d, doc: { type: 'doc', content: paragraphs } });
  const run = (text: string, ...marks: string[]) => ({ type: 'text', text, ...(marks.length ? { marks: marks.map((type) => ({ type })) } : {}) });
  const parse = (raw: object) => parseDocument({ document: JSON.stringify(raw) });

  it('puts text with the default defaults in [Basic Paragraph] and creates no style for it', () => {
    const doc = parse(v1({ s: story('s', defaults(), { type: 'paragraph', content: [run('Hi')] }) }, { t: textFrame('t', 's') }));
    expect(doc.paragraphStyleOrder).toEqual([BASIC_PARAGRAPH_ID]);
    expect(paragraphAttrs(doc.stories.s!.doc.content![0]!)).toEqual({ style: BASIC_PARAGRAPH_ID });
  });

  it('turns strong into the weight bolder gave it and em into italic, and drops marks that change nothing', () => {
    const doc = parse(
      v1(
        {
          a: story('a', defaults({ fontWeight: 400 }), { type: 'paragraph', content: [run('a', 'strong'), run('b', 'em'), run('c', 'strong', 'em'), run('d')] }),
          b: story('b', defaults({ fontWeight: 700 }), { type: 'paragraph', content: [run('a', 'strong'), run('b', 'em')] }),
          c: story('c', defaults({ fontWeight: 900, fontStyle: 'italic' }), { type: 'paragraph', content: [run('x'), run('a', 'strong'), run('b', 'em'), run('c', 'strong', 'em'), run('y')] }),
        },
        { ta: textFrame('ta', 'a'), tb: textFrame('tb', 'b'), tc: textFrame('tc', 'c') },
      ),
    );
    const marks = (id: string) => doc.stories[id]!.doc.content![0]!.content!.map((t) => [t.text, t.marks?.[0]?.attrs]);
    expect(marks('a')).toEqual([
      ['a', { shared: { fontWeight: 700 } }],
      ['b', { shared: { fontStyle: 'italic' } }],
      ['c', { shared: { fontWeight: 700, fontStyle: 'italic' } }],
      ['d', undefined],
    ]);
    expect(marks('b')).toEqual([
      ['a', { shared: { fontWeight: 900 } }],
      ['b', { shared: { fontStyle: 'italic' } }],
    ]);
    // weight 900 italic: nothing to change, so the runs merge into one plain run
    expect(marks('c')).toEqual([['xabcy', undefined]]);
    expect(bolderWeight(300)).toBe(400);
    expect(bolderWeight(400)).toBe(700);
    expect(bolderWeight(600)).toBe(900);
    expect(bolderWeight(800)).toBe(900);
  });

  it('names styles by what they set and numbers a name that is taken', () => {
    const doc = parse(
      v1(
        {
          a: story('a', defaults({ fontWeight: 800, fontSize: 160, leading: 168 }), { type: 'paragraph' }),
          b: story('b', defaults({ fontWeight: 800, fontSize: 160, leading: 168, fill: { swatchId: 'red', tint: 100, overprint: false } }), { type: 'paragraph' }),
          c: story('c', defaults({ fontStyle: 'italic', fontSize: 10.5, leading: 13.5 }), { type: 'paragraph' }),
          d: story('d', defaults({ fontWeight: 450 }), { type: 'paragraph' }),
        },
        { ta: textFrame('ta', 'a'), tb: textFrame('tb', 'b'), tc: textFrame('tc', 'c'), td: textFrame('td', 'd') },
      ),
    );
    expect(doc.paragraphStyleOrder.slice(1).map((id) => doc.paragraphStyles[id]!.name)).toEqual(['Inter ExtraBold 160/168', 'Inter ExtraBold 160/168 (2)', 'Inter Regular Italic 10.5/13.5', 'Inter W450 12/15']);
    expect(describeTextAttrs({ fontFamily: 'Minion', fontWeight: 600, fontStyle: 'normal', fontSize: 9, leading: 12, tracking: 0, align: 'left', fill: { swatchId: 'black', tint: 100, overprint: false } })).toBe('Minion SemiBold 9/12');
    expect(validateDocument(doc)).toEqual([]);
  });

  it('shares one style between stories with equal defaults and gives every story its frames', () => {
    const doc = parse(
      v1(
        { a: story('a', defaults({ fontSize: 20 }), { type: 'paragraph' }), b: story('b', defaults({ fontSize: 20 }), { type: 'paragraph' }) },
        { ta: textFrame('ta', 'a'), tb: textFrame('tb', 'b') },
      ),
    );
    expect(doc.paragraphStyleOrder).toHaveLength(2);
    expect(doc.stories.a!.frameIds).toEqual(['ta']);
    expect(doc.stories.b!.frameIds).toEqual(['tb']);
  });

  it('reports a story that is not a valid v1 story, naming it', () => {
    const bad = v1({ s: { id: 's', doc: { type: 'doc', content: [{ type: 'paragraph' }] } } }, { t: textFrame('t', 's') });
    expect(() => parse(bad)).toThrow(DocumentParseError);
    expect(() => parse(bad)).toThrow(/story "s" is not a valid v1 story/);
    const heading = v1({ s: story('s', defaults(), { type: 'heading' }) }, { t: textFrame('t', 's') });
    expect(() => parse(heading)).toThrow(/story "s"/);
    expect(() => migrateV1ToV2({ formatVersion: 1, stories: [] })).toThrow(/stories/);
  });

  it('leaves a document without stories alone apart from the new tables', () => {
    const doc = parse(v1({}));
    expect(doc.stories).toEqual({});
    expect(doc.paragraphStyleOrder).toEqual([BASIC_PARAGRAPH_ID]);
    expect(doc.characterStyleOrder).toEqual(['none']);
    expect(validateDocument(doc)).toEqual([]);
  });
});
