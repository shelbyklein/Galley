import { describe, expect, it } from 'vitest';
import {
  addStyle,
  applyCharacterStyle,
  applyParagraphStyle,
  BASIC_PARAGRAPH_ID,
  BASIC_PARAGRAPH_PROPS,
  basicParagraphLayers,
  CommandError,
  moveStyle,
  NONE_CHARACTER_ID,
  paint,
  paragraphAttrs,
  removeStyle,
  resolveParagraph,
  resolveParagraphStyle,
  resolveRun,
  setStyle,
  setTextOverrides,
  styleChain,
  StyleChainError,
  validateDocument,
  type CharacterStyle,
  type HistoryState,
  type ParagraphStyle,
  type StoryRange,
} from '../src';
import { history, run, textFrameArgs } from './helpers';
import { addFrame } from '../src';

const para = (id: string, name: string, basedOn: string | null, shared: ParagraphStyle['shared'] = {}, print: ParagraphStyle['print'] = {}): ParagraphStyle => ({ id, name, basedOn, shared, print, web: {} });
const chr = (id: string, name: string, basedOn: string | null, shared: CharacterStyle['shared'] = {}, print: CharacterStyle['print'] = {}): CharacterStyle => ({ id, name, basedOn, shared, print, web: {} });

/** [Basic Paragraph] <- Body (10/13.5 justified, indent 12) <- Body First (no indent); Headline <- [Basic Paragraph]; character styles Strong <- Emphasis. */
function styled(): HistoryState {
  let h = history();
  h = run(h, addStyle, { kind: 'paragraph', style: para('body', 'Body', BASIC_PARAGRAPH_ID, { features: { liga: false } }, { fontSize: 10, leading: 13.5, firstLineIndent: 12, align: 'justify' }) });
  h = run(h, addStyle, { kind: 'paragraph', style: para('body-first', 'Body First', 'body', { fontStyle: 'italic' }, { firstLineIndent: 0 }) });
  h = run(h, addStyle, { kind: 'paragraph', style: para('headline', 'Headline', BASIC_PARAGRAPH_ID, { fontWeight: 800, fill: paint('orange') }, { fontSize: 40, leading: 42 }) });
  h = run(h, addStyle, { kind: 'character', style: chr('strong', 'Strong', null, { fontWeight: 700, features: { onum: true } }) });
  h = run(h, addStyle, { kind: 'character', style: chr('loud', 'Loud', 'strong', { fill: paint('spot185') }, { fontSize: 14, baselineShift: 2 }) });
  return h;
}

const at = (paragraph: number, offset: number) => ({ paragraph, offset });
const range = (from: [number, number], to: [number, number]): StoryRange => ({ from: at(...from), to: at(...to) });

describe('built-in styles', () => {
  it('a new document has [Basic Paragraph] with every property set, and an empty [None]', () => {
    const doc = history().doc;
    expect(doc.paragraphStyleOrder).toEqual([BASIC_PARAGRAPH_ID]);
    expect(doc.paragraphStyles[BASIC_PARAGRAPH_ID]).toMatchObject({ name: '[Basic Paragraph]', basedOn: null, web: {} });
    const { shared, print } = doc.paragraphStyles[BASIC_PARAGRAPH_ID]!;
    expect(Object.keys(shared).sort()).toEqual(Object.keys(basicParagraphLayers().shared).sort());
    expect(Object.keys(print)).toHaveLength(Object.keys(basicParagraphLayers().print).length);
    expect(doc.characterStyles[NONE_CHARACTER_ID]).toEqual({ id: 'none', name: '[None]', basedOn: null, shared: {}, print: {}, web: {} });
  });

  it('[Basic Paragraph] resolves to the constants, which are what a Phase 1 default story looked like', () => {
    expect(resolveParagraphStyle(history().doc, BASIC_PARAGRAPH_ID)).toEqual(BASIC_PARAGRAPH_PROPS);
    expect(BASIC_PARAGRAPH_PROPS).toMatchObject({ fontFamily: 'Inter', fontWeight: 400, fontStyle: 'normal', fontSize: 12, leading: 15, tracking: 0, align: 'left', fill: { swatchId: 'black', tint: 100, overprint: false } });
  });

  it('cannot be deleted or renamed, and [None] cannot be edited', () => {
    const h = history();
    expect(() => run(h, removeStyle, { kind: 'paragraph', id: BASIC_PARAGRAPH_ID })).toThrow(/built-in/);
    expect(() => run(h, removeStyle, { kind: 'character', id: NONE_CHARACTER_ID })).toThrow(/built-in/);
    expect(() => run(h, setStyle, { kind: 'paragraph', style: { ...h.doc.paragraphStyles[BASIC_PARAGRAPH_ID]!, name: 'Mine' } })).toThrow(/renamed/);
    expect(() => run(h, setStyle, { kind: 'paragraph', style: { ...h.doc.paragraphStyles[BASIC_PARAGRAPH_ID]!, basedOn: BASIC_PARAGRAPH_ID } })).toThrow(CommandError);
    expect(() => run(h, setStyle, { kind: 'character', style: { ...h.doc.characterStyles[NONE_CHARACTER_ID]!, shared: { fontWeight: 700 } } })).toThrow(/\[None\]/);
    // [Basic Paragraph]'s properties can change: it is the document's default text
    const changed = run(h, setStyle, { kind: 'paragraph', style: { ...h.doc.paragraphStyles[BASIC_PARAGRAPH_ID]!, print: { ...h.doc.paragraphStyles[BASIC_PARAGRAPH_ID]!.print, fontSize: 9 } } });
    expect(resolveParagraphStyle(changed.doc, BASIC_PARAGRAPH_ID).fontSize).toBe(9);
  });
});

describe('basedOn chains and overrides resolve in order', () => {
  const doc = styled().doc;

  it('walks the chain from the root: each style overrides only what it sets', () => {
    expect(styleChain(doc.paragraphStyles, 'body-first').map((s) => s.id)).toEqual([BASIC_PARAGRAPH_ID, 'body', 'body-first']);
    const r = resolveParagraphStyle(doc, 'body-first');
    expect(r).toMatchObject({
      fontFamily: 'Inter', // [Basic Paragraph]
      fontWeight: 400,
      fontSize: 10, // Body
      leading: 13.5,
      align: 'justify',
      fontStyle: 'italic', // Body First
      firstLineIndent: 0, // Body First overrides Body's 12
      spaceAfter: 0, // nobody sets it
    });
    expect(resolveParagraphStyle(doc, 'body').firstLineIndent).toBe(12);
    expect(resolveParagraphStyle(doc, 'headline')).toMatchObject({ fontWeight: 800, fontSize: 40, leading: 42, fill: paint('orange'), align: 'left' });
  });

  it('merges OpenType features key by key down the chain', () => {
    expect(resolveParagraphStyle(doc, 'body').features).toEqual({ liga: false });
    expect(resolveParagraphStyle(doc, 'body-first').features).toEqual({ liga: false });
    expect(resolveParagraph(doc, { style: 'body', overrides: { shared: { features: { smcp: true, liga: true } } } }).features).toEqual({ liga: true, smcp: true });
  });

  it('local overrides win over the style, and leave the style untouched', () => {
    const r = resolveParagraph(doc, { style: 'body-first', overrides: { print: { fontSize: 11, align: 'center' }, shared: { tracking: 25 } } });
    expect(r).toMatchObject({ fontSize: 11, align: 'center', tracking: 25, leading: 13.5, fontStyle: 'italic' });
    expect(resolveParagraphStyle(doc, 'body-first').fontSize).toBe(10);
    expect(resolveParagraph(doc, { style: 'body' })).toBe(resolveParagraphStyle(doc, 'body'));
  });

  it('resolves a run: the paragraph, then its character style chain, then its override mark', () => {
    const p = resolveParagraphStyle(doc, 'body');
    expect(resolveRun(doc, p, undefined)).toBe(p);
    expect(resolveRun(doc, p, [])).toBe(p);
    const strong = resolveRun(doc, p, [{ type: 'charStyle', attrs: { style: 'strong' } }]);
    expect(strong).toMatchObject({ fontWeight: 700, fontSize: 10, features: { liga: false, onum: true } });
    const loud = resolveRun(doc, p, [{ type: 'charStyle', attrs: { style: 'loud' } }]);
    expect(loud).toMatchObject({ fontWeight: 700, fill: paint('spot185'), fontSize: 14, baselineShift: 2, align: 'justify' });
    const overridden = resolveRun(doc, p, [
      { type: 'charStyle', attrs: { style: 'loud' } },
      { type: 'override', attrs: { shared: { fontWeight: 900 }, print: { fontSize: 20 } } },
    ]);
    expect(overridden).toMatchObject({ fontWeight: 900, fontSize: 20, fill: paint('spot185'), baselineShift: 2 });
    // a run never changes paragraph-only properties
    expect(overridden.firstLineIndent).toBe(12);
  });

  it('a style based on nothing starts from the constants, not from [Basic Paragraph]\'s stored values', () => {
    let h = run(history(), setStyle, {
      kind: 'paragraph',
      style: { ...history().doc.paragraphStyles[BASIC_PARAGRAPH_ID]!, print: { ...history().doc.paragraphStyles[BASIC_PARAGRAPH_ID]!.print, fontSize: 9 } },
    });
    h = run(h, addStyle, { kind: 'paragraph', style: para('loose', 'Loose', null, {}, { leading: 20 }) });
    h = run(h, addStyle, { kind: 'paragraph', style: para('based', 'Based', BASIC_PARAGRAPH_ID, {}, { leading: 20 }) });
    expect(resolveParagraphStyle(h.doc, 'loose').fontSize).toBe(12);
    expect(resolveParagraphStyle(h.doc, 'based').fontSize).toBe(9);
  });
});

describe('a style cycle is rejected', () => {
  it('by setStyle: a style cannot become based on itself or on its own descendant', () => {
    const h = styled();
    const body = h.doc.paragraphStyles.body!;
    expect(() => run(h, setStyle, { kind: 'paragraph', style: { ...body, basedOn: 'body' } })).toThrow(/based on itself/);
    expect(() => run(h, setStyle, { kind: 'paragraph', style: { ...body, basedOn: 'body-first' } })).toThrow(/based on itself/);
    expect(() => run(h, setStyle, { kind: 'character', style: { ...h.doc.characterStyles.strong!, basedOn: 'loud' } })).toThrow(/based on itself/);
    // re-basing sideways is fine
    expect(resolveParagraphStyle(run(h, setStyle, { kind: 'paragraph', style: { ...body, basedOn: 'headline' } }).doc, 'body-first').fontWeight).toBe(800);
  });

  it('by addStyle: an unknown base, and by the validator for a hand-edited file', () => {
    const h = styled();
    expect(() => run(h, addStyle, { kind: 'paragraph', style: para('x', 'X', 'ghost') })).toThrow(/No paragraph style "ghost"/);
    const broken = structuredClone(h.doc);
    broken.paragraphStyles.body!.basedOn = 'body-first';
    const issues = validateDocument(broken);
    expect(issues.map((i) => i.code)).toContain('style-cycle');
    expect(() => styleChain(broken.paragraphStyles, 'body-first')).toThrow(StyleChainError);
    expect(() => resolveParagraphStyle(broken, 'body')).toThrow(/based on itself/);
  });

  it('rejects a duplicate name and a missing swatch', () => {
    const h = styled();
    expect(() => run(h, addStyle, { kind: 'paragraph', style: para('x', 'Body', BASIC_PARAGRAPH_ID) })).toThrow(/already exists/);
    expect(() => run(h, addStyle, { kind: 'paragraph', style: para('body', 'Other', BASIC_PARAGRAPH_ID) })).toThrow(/already exists/);
    expect(() => run(h, addStyle, { kind: 'paragraph', style: para('x', 'X', BASIC_PARAGRAPH_ID, { fill: paint('ghost') }) })).toThrow(/No swatch/);
    expect(() => run(h, addStyle, { kind: 'paragraph', style: para('x', 'X', BASIC_PARAGRAPH_ID, {}, { fontSize: 0 }) })).toThrow(CommandError);
    expect(() => run(h, addStyle, { kind: 'character', style: { ...chr('c', 'C', null), print: { leftIndent: 4 } } as never })).toThrow(CommandError); // an indent is not a character property
    expect(validateDocument(h.doc)).toEqual([]);
  });
});

describe('redefining a style updates every use', () => {
  it('paragraphs and the styles based on it follow, because everything refers by id', () => {
    let h = styled();
    h = run(h, addFrame, textFrameArgs('t', 's', 'One\nTwo'));
    h = run(h, applyParagraphStyle, { storyId: 's', range: range([0, 0], [1, 0]), styleId: 'body-first' });
    const before = resolveParagraph(h.doc, paragraphAttrs(h.doc.stories.s!.doc.content![1]!));
    expect(before.fontSize).toBe(10);
    h = run(h, setStyle, { kind: 'paragraph', style: { ...h.doc.paragraphStyles.body!, print: { ...h.doc.paragraphStyles.body!.print, fontSize: 11 } } });
    for (const p of h.doc.stories.s!.doc.content!) expect(resolveParagraph(h.doc, paragraphAttrs(p)).fontSize).toBe(11);
    expect(validateDocument(h.doc)).toEqual([]);
  });
});

describe('deleting a style', () => {
  it('moves its paragraphs to the replacement and keeps the look of the styles based on it', () => {
    let h = styled();
    h = run(h, addFrame, textFrameArgs('t', 's', 'One\nTwo'));
    h = run(h, applyParagraphStyle, { storyId: 's', range: range([0, 0], [0, 0]), styleId: 'body' });
    h = run(h, applyParagraphStyle, { storyId: 's', range: range([1, 0], [1, 0]), styleId: 'body-first' });
    const lookBefore = resolveParagraphStyle(h.doc, 'body-first');
    h = run(h, removeStyle, { kind: 'paragraph', id: 'body', replacementId: 'headline' });
    expect(h.doc.paragraphStyles.body).toBeUndefined();
    expect(h.doc.paragraphStyleOrder).not.toContain('body');
    expect(h.doc.paragraphStyles['body-first']!.basedOn).toBe(BASIC_PARAGRAPH_ID);
    expect(resolveParagraphStyle(h.doc, 'body-first')).toEqual(lookBefore); // folded in: nothing about it changed
    expect(paragraphAttrs(h.doc.stories.s!.doc.content![0]!).style).toBe('headline');
    expect(validateDocument(h.doc)).toEqual([]);
    expect(() => run(h, removeStyle, { kind: 'paragraph', id: 'headline', replacementId: 'headline' })).toThrow(/being deleted/);
  });

  it('removes a character style from the runs (or swaps it), keeping local overrides', () => {
    let h = styled();
    h = run(h, addFrame, textFrameArgs('t', 's', 'Hello world'));
    h = run(h, applyCharacterStyle, { storyId: 's', range: range([0, 0], [0, 5]), styleId: 'loud' });
    h = run(h, setTextOverrides, { storyId: 's', range: range([0, 0], [0, 5]), target: 'character', patch: { set: { print: { fontSize: 30 } } } });
    const swapped = run(h, removeStyle, { kind: 'character', id: 'loud', replacementId: 'strong' });
    expect(JSON.stringify(swapped.doc.stories.s!.doc)).toContain('"style":"strong"');
    expect(validateDocument(swapped.doc)).toEqual([]);
    const dropped = run(h, removeStyle, { kind: 'character', id: 'loud' });
    expect(JSON.stringify(dropped.doc.stories.s!.doc)).not.toContain('charStyle');
    expect(JSON.stringify(dropped.doc.stories.s!.doc)).toContain('"fontSize":30');
    // and the character style based on it takes over what it set
    const deletedBase = run(h, removeStyle, { kind: 'character', id: 'strong' });
    expect(deletedBase.doc.characterStyles.loud).toMatchObject({ basedOn: null, shared: { fontWeight: 700, fill: paint('spot185') } });
    expect(validateDocument(deletedBase.doc)).toEqual([]);
  });

  it('a paragraph style needs a replacement (the default is [Basic Paragraph])', () => {
    const h = styled();
    expect(() => run(h, removeStyle, { kind: 'paragraph', id: 'headline', replacementId: null })).toThrow(/replacement/);
    expect(run(h, removeStyle, { kind: 'paragraph', id: 'headline' }).doc.paragraphStyles.headline).toBeUndefined();
  });
});

describe('the styles panel order', () => {
  it('adds at an index and moves styles', () => {
    let h = styled();
    expect(h.doc.paragraphStyleOrder).toEqual([BASIC_PARAGRAPH_ID, 'body', 'body-first', 'headline']);
    h = run(h, addStyle, { kind: 'paragraph', style: para('caption', 'Caption', BASIC_PARAGRAPH_ID), index: 1 });
    expect(h.doc.paragraphStyleOrder).toEqual([BASIC_PARAGRAPH_ID, 'caption', 'body', 'body-first', 'headline']);
    h = run(h, moveStyle, { kind: 'paragraph', id: 'headline', index: 0 });
    expect(h.doc.paragraphStyleOrder[0]).toBe('headline');
    expect(() => run(h, moveStyle, { kind: 'paragraph', id: 'headline', index: 99 })).toThrow(/out of range/);
    expect(validateDocument(h.doc)).toEqual([]);
  });
});
