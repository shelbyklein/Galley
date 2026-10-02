import { describe, expect, it } from 'vitest';
import {
  addFrame,
  addStyle,
  applyCharacterStyle,
  applyCharacterStyleInDoc,
  applyParagraphStyle,
  BASIC_PARAGRAPH_ID,
  charStyleMark,
  clearCharacterOverridesInDoc,
  clearParagraphOverridesInDoc,
  clearTextOverrides,
  CommandError,
  createStory,
  normalizeStoryDoc,
  orderRange,
  overrideMark,
  paint,
  paragraphAttrs,
  paragraphNode,
  patchCharacterOverridesInDoc,
  patchParagraphOverridesInDoc,
  setBaselineGrid,
  setFrameProps,
  setParagraphStyleInDoc,
  setTextOverrides,
  storyDocFromText,
  storyDocProblem,
  storyDocReferenceProblem,
  storyPlainText,
  styledParagraph,
  textNode,
  TextRangeError,
  validateDocument,
  wrapOf,
  type PMNode,
  type StoryRange,
} from '../src';
import { history, run, textFrameArgs } from './helpers';

const range = (from: [number, number], to: [number, number]): StoryRange => ({ from: { paragraph: from[0], offset: from[1] }, to: { paragraph: to[0], offset: to[1] } });
/** `[text, marks]` per run of each paragraph, marks as compact JSON. */
const runs = (doc: PMNode) => (doc.content ?? []).map((p) => (p.content ?? []).map((t) => [t.text, t.marks ? JSON.stringify(t.marks.map((m) => [m.type, m.attrs])) : '']));

describe('the story document schema', () => {
  it('accepts paragraphs with a style, local overrides, and character marks in order', () => {
    const doc: PMNode = {
      type: 'doc',
      content: [
        styledParagraph({ style: 'body', overrides: { print: { align: 'center' } } }, 'Plain ', textNode('x', [overrideMark({ shared: { fontWeight: 700 } }), charStyleMark('strong')])),
        { type: 'paragraph', attrs: { style: 'body' } },
      ],
    };
    expect(storyDocProblem(doc)).toBeNull();
    expect(runs(doc)[0]![1]![1]).toContain('["charStyle",{"style":"strong"}],["override"'); // textNode put them in canonical order
  });

  it('rejects: no paragraph, a missing style, unknown nodes and marks, empty text, marks out of order, empty or paragraph-only character overrides', () => {
    const p = (extra: object) => ({ type: 'doc', content: [{ type: 'paragraph', attrs: { style: 'body' }, ...extra }] }) as PMNode;
    expect(storyDocProblem({ type: 'doc', content: [] })).toMatch(/at least|too small/i);
    expect(storyDocProblem({ type: 'doc', content: [{ type: 'paragraph' }] })).not.toBeNull(); // v1 paragraphs had no attrs
    expect(storyDocProblem({ type: 'doc', content: [{ type: 'heading' }] })).not.toBeNull();
    expect(storyDocProblem(p({ content: [{ type: 'text', text: '' }] }))).not.toBeNull();
    expect(storyDocProblem(p({ content: [{ type: 'text', text: 'a', marks: [{ type: 'strong' }] }] }))).not.toBeNull(); // v1 marks
    expect(storyDocProblem(p({ content: [{ type: 'text', text: 'a', marks: [] }] }))).not.toBeNull();
    expect(storyDocProblem(p({ content: [{ type: 'text', text: 'a', marks: [{ type: 'override', attrs: {} }] }] }))).toMatch(/must set something/);
    expect(storyDocProblem(p({ content: [{ type: 'text', text: 'a', marks: [{ type: 'override', attrs: { print: { leftIndent: 3 } } }] }] }))).not.toBeNull();
    expect(storyDocProblem(p({ content: [{ type: 'text', text: 'a', marks: [overrideMark({ shared: { tracking: 1 } }), charStyleMark('x')] }] }))).toMatch(/at most one charStyle then one override/);
    expect(storyDocProblem({ type: 'doc', content: [{ type: 'paragraph', attrs: { style: 'body', overrides: {} } }] })).toMatch(/empty overrides/);
    expect(storyDocProblem({ type: 'doc', content: [{ type: 'paragraph', attrs: { style: 'body', overrides: null } }] } as never)).not.toBeNull(); // ProseMirror's null: normalize first
  });

  it('checks references: paragraph style, character style, swatch, and [None] is not a mark', () => {
    const refs = { paragraphStyles: { body: 1 }, characterStyles: { strong: 1 }, swatches: { black: 1 } };
    expect(storyDocReferenceProblem(storyDocFromText('x', { style: 'body' }), refs)).toBeNull();
    expect(storyDocReferenceProblem(storyDocFromText('x', { style: 'nope' }), refs)).toMatch(/paragraph style "nope"/);
    expect(storyDocReferenceProblem({ type: 'doc', content: [styledParagraph({ style: 'body' }, textNode('a', [charStyleMark('ghost')]))] }, refs)).toMatch(/character style "ghost"/);
    expect(storyDocReferenceProblem({ type: 'doc', content: [styledParagraph({ style: 'body' }, textNode('a', [charStyleMark('none')]))] }, refs)).toMatch(/\[None\]/);
    expect(storyDocReferenceProblem({ type: 'doc', content: [styledParagraph({ style: 'body' }, textNode('a', [overrideMark({ shared: { fill: paint('ghost') } })]))] }, refs)).toMatch(/swatch "ghost"/);
  });

  it('normalizes ProseMirror output: nulls and view-only attrs go, empty overrides go, equal neighbours merge', () => {
    const fromPM: PMNode = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { style: 'body', overrides: null, cont: false, tail: '' } as never,
          content: [
            { type: 'text', text: 'a' },
            { type: 'text', text: 'b', marks: [{ type: 'override', attrs: {} }] },
            { type: 'text', text: '', marks: [charStyleMark('x')] },
            { type: 'text', text: 'c', marks: [overrideMark({ shared: { tracking: 5 } }), charStyleMark('x')] },
            { type: 'text', text: 'd', marks: [charStyleMark('x'), overrideMark({ shared: { tracking: 5 } })] },
          ],
        },
        { type: 'paragraph', attrs: { style: 'body', overrides: { print: {} } } as never },
      ],
    };
    const normal = normalizeStoryDoc(fromPM);
    expect(storyDocProblem(normal)).toBeNull();
    expect(runs(normal)[0]!.map((r) => r[0])).toEqual(['ab', 'cd']);
    expect(paragraphAttrs(normal.content![1]!)).toEqual({ style: 'body' });
    expect(normal.content![0]!.attrs).toEqual({ style: 'body' });
    expect(normalizeStoryDoc(normal)).toEqual(normal); // idempotent
    expect(normalizeStoryDoc({ type: 'doc', content: [] })).toEqual({ type: 'doc', content: [paragraphNode()] });
  });
});

describe('editing a story over a range', () => {
  const base = (): PMNode => ({ type: 'doc', content: [paragraphNode('Hello world'), paragraphNode('Second one'), paragraphNode('Third')] });

  it('orders and checks a range', () => {
    expect(orderRange(base(), range([1, 3], [0, 2]))).toEqual(range([0, 2], [1, 3]));
    expect(() => orderRange(base(), range([0, 0], [5, 0]))).toThrow(TextRangeError);
    expect(() => orderRange(base(), range([0, 0], [0, 99]))).toThrow(/out of range/);
    expect(() => orderRange(base(), range([0, -1], [0, 2]))).toThrow(TextRangeError);
  });

  it('applies a paragraph style to every paragraph the range touches, keeping or clearing overrides', () => {
    let doc = patchParagraphOverridesInDoc(base(), range([1, 0], [1, 0]), { set: { print: { align: 'right' } } });
    doc = setParagraphStyleInDoc(doc, range([0, 5], [1, 2]), 'body');
    expect(doc.content!.map((p) => paragraphAttrs(p).style)).toEqual(['body', 'body', BASIC_PARAGRAPH_ID]);
    expect(paragraphAttrs(doc.content![1]!).overrides).toEqual({ print: { align: 'right' } });
    doc = setParagraphStyleInDoc(doc, range([1, 0], [2, 0]), 'head', true);
    expect(doc.content!.map((p) => paragraphAttrs(p))).toEqual([{ style: 'body' }, { style: 'head' }, { style: 'head' }]);
  });

  it('sets, merges and unsets paragraph overrides; nothing left means no overrides at all', () => {
    let doc = patchParagraphOverridesInDoc(base(), range([0, 0], [0, 0]), { set: { print: { align: 'center', fontSize: 14 }, shared: { tracking: 20 } } });
    doc = patchParagraphOverridesInDoc(doc, range([0, 0], [0, 0]), { set: { print: { align: 'right' } }, unset: { print: ['fontSize'] } });
    expect(paragraphAttrs(doc.content![0]!).overrides).toEqual({ shared: { tracking: 20 }, print: { align: 'right' } });
    doc = patchParagraphOverridesInDoc(doc, range([0, 0], [0, 0]), { unset: { shared: ['tracking'], print: ['align'] } });
    expect(doc.content![0]!.attrs).toEqual({ style: BASIC_PARAGRAPH_ID });
    expect(storyDocProblem(doc)).toBeNull();
    const cleared = clearParagraphOverridesInDoc(patchParagraphOverridesInDoc(base(), range([0, 0], [2, 0]), { set: { print: { align: 'center' } } }), range([1, 0], [1, 0]));
    expect(cleared.content!.map((p) => paragraphAttrs(p).overrides !== undefined)).toEqual([true, false, true]);
  });

  it('applies a character style to part of a paragraph, splitting runs and merging them back', () => {
    let doc = applyCharacterStyleInDoc(base(), range([0, 2], [0, 7]), 'strong');
    expect(runs(doc)[0]!.map((r) => r[0])).toEqual(['He', 'llo w', 'orld']);
    expect(runs(doc)[0]![1]![1]).toBe('[["charStyle",{"style":"strong"}]]');
    doc = applyCharacterStyleInDoc(doc, range([0, 0], [0, 11]), 'strong'); // the whole paragraph: one run again
    expect(runs(doc)[0]).toEqual([['Hello world', '[["charStyle",{"style":"strong"}]]']]);
    doc = applyCharacterStyleInDoc(doc, range([0, 0], [0, 11]), null);
    expect(runs(doc)[0]).toEqual([['Hello world', '']]);
    expect(applyCharacterStyleInDoc(base(), range([0, 3], [0, 3]), 'strong')).toEqual(base()); // collapsed: nothing to format
    expect(runs(applyCharacterStyleInDoc(base(), range([0, 6], [2, 2]), 'strong')).map((r) => r.length)).toEqual([2, 1, 2]); // across paragraphs
    expect(runs(applyCharacterStyleInDoc(base(), range([0, 0], [0, 11]), 'none'))[0]).toEqual([['Hello world', '']]); // [None] is no mark
  });

  it('sets character overrides alongside a character style, and clears them without touching the style', () => {
    let doc = applyCharacterStyleInDoc(base(), range([0, 0], [0, 5]), 'strong');
    doc = patchCharacterOverridesInDoc(doc, range([0, 3], [0, 8]), { set: { shared: { fontWeight: 900 }, print: { fontSize: 20 } } });
    expect(runs(doc)[0]!.map((r) => r[0])).toEqual(['Hel', 'lo', ' wo', 'rld']);
    expect(runs(doc)[0]![1]![1]).toBe('[["charStyle",{"style":"strong"}],["override",{"shared":{"fontWeight":900},"print":{"fontSize":20}}]]');
    doc = patchCharacterOverridesInDoc(doc, range([0, 3], [0, 8]), { unset: { print: ['fontSize'] } });
    expect(JSON.stringify(doc)).not.toContain('fontSize');
    doc = clearCharacterOverridesInDoc(doc, range([0, 0], [0, 11]));
    expect(JSON.stringify(doc)).not.toContain('override');
    expect(JSON.stringify(doc)).toContain('"charStyle"');
    expect(storyDocProblem(doc)).toBeNull();
  });

  it('never mutates its input', () => {
    const input = base();
    const frozen = structuredClone(input);
    applyCharacterStyleInDoc(input, range([0, 0], [2, 3]), 'strong');
    patchParagraphOverridesInDoc(input, range([0, 0], [2, 3]), { set: { print: { align: 'center' } } });
    setParagraphStyleInDoc(input, range([0, 0], [2, 3]), 'body', true);
    expect(input).toEqual(frozen);
  });
});

describe('story formatting commands', () => {
  const start = () => {
    let h = run(history(), addFrame, textFrameArgs('t', 's', 'Hello world\nSecond'));
    h = run(h, addStyle, { kind: 'paragraph', style: { id: 'body', name: 'Body', basedOn: BASIC_PARAGRAPH_ID, shared: {}, print: { fontSize: 10 }, web: {} } });
    h = run(h, addStyle, { kind: 'character', style: { id: 'strong', name: 'Strong', basedOn: null, shared: { fontWeight: 700 }, print: {}, web: {} } });
    return h;
  };
  const rng = range([0, 0], [1, 6]);

  it('apply styles, set and clear overrides, each one undo step, the document staying valid', () => {
    let h = start();
    h = run(h, applyParagraphStyle, { storyId: 's', range: rng, styleId: 'body' });
    h = run(h, applyCharacterStyle, { storyId: 's', range: range([0, 0], [0, 5]), styleId: 'strong' });
    h = run(h, setTextOverrides, { storyId: 's', range: range([0, 6], [0, 11]), target: 'character', patch: { set: { shared: { fontStyle: 'italic' } } } });
    h = run(h, setTextOverrides, { storyId: 's', range: range([1, 0], [1, 0]), target: 'paragraph', patch: { set: { print: { align: 'justify' } } } });
    expect(validateDocument(h.doc)).toEqual([]);
    expect(storyPlainText(h.doc.stories.s!.doc)).toBe('Hello world\nSecond');
    expect(paragraphAttrs(h.doc.stories.s!.doc.content![1]!)).toEqual({ style: 'body', overrides: { print: { align: 'justify' } } });
    h = run(h, clearTextOverrides, { storyId: 's', range: rng, scope: 'all' });
    expect(JSON.stringify(h.doc.stories.s!.doc)).not.toContain('override');
    expect(JSON.stringify(h.doc.stories.s!.doc)).toContain('"charStyle"');
  });

  it('a change with no effect leaves no undo step, and a bad request leaves the document alone', () => {
    const h = start();
    expect(run(h, applyParagraphStyle, { storyId: 's', range: rng, styleId: BASIC_PARAGRAPH_ID })).toBe(h);
    expect(run(h, clearTextOverrides, { storyId: 's', range: rng, scope: 'all' })).toBe(h);
    expect(() => run(h, applyParagraphStyle, { storyId: 's', range: rng, styleId: 'ghost' })).toThrow(/No paragraph style/);
    expect(() => run(h, applyCharacterStyle, { storyId: 's', range: rng, styleId: 'ghost' })).toThrow(/No character style/);
    expect(() => run(h, applyParagraphStyle, { storyId: 'ghost', range: rng, styleId: 'body' })).toThrow(/No story/);
    expect(() => run(h, applyCharacterStyle, { storyId: 's', range: range([0, 0], [9, 0]), styleId: 'strong' })).toThrow(/out of range/);
    expect(() => run(h, setTextOverrides, { storyId: 's', range: rng, target: 'character', patch: { set: { print: { leftIndent: 3 } } as never } })).toThrow(CommandError);
    expect(() => run(h, setTextOverrides, { storyId: 's', range: rng, target: 'paragraph', patch: { set: { shared: { fill: paint('ghost') } } } })).toThrow(/No swatch/);
  });
});

describe('text wrap and the baseline grid', () => {
  it('stores a wrap on any box frame; none clears it; bad numbers and groups are rejected', () => {
    let h = run(history(), addFrame, { frame: { id: 'e', type: 'ellipse', name: '', layerId: 'layer_1', x: 0, y: 0, w: 100, h: 100, rotation: 0, fill: null, stroke: null }, pageId: 'page_1' });
    expect(wrapOf(h.doc.frames.e as never)).toEqual({ mode: 'none' });
    h = run(h, setFrameProps, { ids: ['e'], props: { textWrap: { mode: 'contour', offset: 12 } } });
    expect(h.doc.frames.e).toMatchObject({ textWrap: { mode: 'contour', offset: 12 } });
    h = run(h, setFrameProps, { ids: ['e'], props: { textWrap: { mode: 'boundingBox', offsets: { top: 6, right: 6, bottom: 6, left: 6 } } } });
    expect(wrapOf(h.doc.frames.e as never)).toMatchObject({ mode: 'boundingBox' });
    expect(validateDocument(h.doc)).toEqual([]);
    expect(() => run(h, setFrameProps, { ids: ['e'], props: { textWrap: { mode: 'contour', offset: -1 } } })).toThrow(/Invalid text wrap/);
    expect(() => run(h, setFrameProps, { ids: ['e'], props: { textWrap: { mode: 'sideways' } as never } })).toThrow(CommandError);
    h = run(h, setFrameProps, { ids: ['e'], props: { textWrap: { mode: 'none' } } });
    expect('textWrap' in h.doc.frames.e!).toBe(false);
    h = run(h, setFrameProps, { ids: ['e'], props: { textWrap: { mode: 'contour', offset: 3 } } });
    h = run(h, setFrameProps, { ids: ['e'], props: { textWrap: null } });
    expect('textWrap' in h.doc.frames.e!).toBe(false);
  });

  it('has a document baseline grid with a start and an increment', () => {
    let h = history();
    expect(h.doc.baselineGrid).toEqual({ start: 0, increment: 12 });
    h = run(h, setBaselineGrid, { start: 36, increment: 13.5 });
    expect(h.doc.baselineGrid).toEqual({ start: 36, increment: 13.5 });
    expect(() => run(h, setBaselineGrid, { increment: 0 })).toThrow(/above zero/);
    expect(() => run(h, setBaselineGrid, { start: -1 })).toThrow(CommandError);
    expect(() => run(h, setBaselineGrid, { start: NaN })).toThrow(/finite/);
    expect(validateDocument(h.doc)).toEqual([]);
  });
});

describe('createStory', () => {
  it('makes a story of paragraphs in a style, with local overrides, and no thread yet', () => {
    const s = createStory('s', 'a\nb', { style: 'body', overrides: { print: { align: 'center' } } });
    expect(s).toEqual({
      id: 's',
      frameIds: [],
      doc: { type: 'doc', content: [styledParagraph({ style: 'body', overrides: { print: { align: 'center' } } }, 'a'), styledParagraph({ style: 'body', overrides: { print: { align: 'center' } } }, 'b')] },
    });
    expect(createStory('s', '').doc.content).toEqual([{ type: 'paragraph', attrs: { style: BASIC_PARAGRAPH_ID } }]);
  });
});
