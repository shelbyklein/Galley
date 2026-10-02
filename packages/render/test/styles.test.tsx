// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  addFrame,
  addStyle,
  applyCharacterStyle,
  applyCommand,
  BASIC_PARAGRAPH_ID,
  BASIC_PARAGRAPH_PROPS,
  createDocument,
  createHistory,
  createStory,
  linkFrames,
  paint,
  resolveParagraph,
  resolveParagraphStyle,
  resolveRun,
  setTextOverrides,
  type GalleyDocument,
  type HistoryState,
  type ResolvedParagraph,
} from '@galley/model';
import { createColorResolver, PageView, paragraphCss, runCss, toCssText, usedFontFaces } from '../src';

const doc0 = createDocument({ engineVersion: '44.5.1', page: { id: 'page_1' }, layer: { id: 'layer_1' } });
const colors = createColorResolver(doc0, 'screen');
const css = (r: Partial<ResolvedParagraph>, options = {}) => toCssText(paragraphCss({ ...BASIC_PARAGRAPH_PROPS, ...r }, colors, options));

describe('paragraphCss', () => {
  it('[Basic Paragraph] is exactly what the Phase 1 default story was: font, size, leading, alignment, color, nothing else', () => {
    expect(css({})).toBe(`font-family: "Inter", sans-serif; font-weight: 400; font-style: normal; font-size: 12pt; line-height: 15pt; color: ${colors.css(paint('black'))}; text-align: left`);
  });

  it('emits tracking in em, and only when it is not zero', () => {
    expect(css({ tracking: -20 })).toContain('letter-spacing: -0.02em');
    expect(css({ tracking: 0 })).not.toContain('letter-spacing');
    expect(css({ tracking: 12.5 })).toContain('letter-spacing: 0.0125em');
  });

  it('emits indents, spacing, case, kerning, features and hyphenation only when they differ from the neutral value', () => {
    expect(css({ firstLineIndent: 12, leftIndent: 6, rightIndent: 3, spaceBefore: 4, spaceAfter: 9 })).toMatch(/text-indent: 12pt; padding-left: 6pt; padding-right: 3pt; padding-top: 4pt; padding-bottom: 9pt$/);
    expect(css({ spaceBefore: 4, spaceAfter: 9 }, { dropSpaceBefore: true })).toMatch(/padding-bottom: 9pt$/);
    expect(css({ spaceBefore: 4 }, { dropSpaceBefore: true })).not.toContain('padding');
    expect(css({ firstLineIndent: -8 })).toContain('text-indent: -8pt');
    expect(css({ textCase: 'allCaps' })).toContain('text-transform: uppercase');
    expect(css({ textCase: 'smallCaps' })).toContain('font-variant-caps: small-caps');
    expect(css({ kerning: 'none' })).toContain('font-kerning: none');
    expect(css({ features: { onum: true, liga: false } })).toContain('font-feature-settings: "liga" 0, "onum" 1');
    expect(css({ hyphenate: false })).toContain('hyphens: manual');
    expect(css({ hyphenate: true })).not.toContain('hyphens');
    expect(css({ hyphenMinWord: 6, hyphenMinBefore: 3, hyphenMinAfter: null })).toContain('hyphenate-limit-chars: 6 3 auto');
    expect(css({ align: 'justify' })).toContain('text-align: justify');
  });

  it('takes colors from the color resolver, so export mode paints sentinels', () => {
    const exportDoc = (() => {
      let h = createHistory(doc0);
      h = applyCommand(h, addFrame, { frame: { id: 't', type: 'text', name: '', layerId: 'layer_1', x: 0, y: 0, w: 10, h: 10, rotation: 0, fill: null, stroke: null, storyId: 's', inset: 0 }, pageId: 'page_1', story: createStory('s', 'x') });
      return h.doc;
    })();
    const exportColors = createColorResolver(exportDoc, 'export');
    expect(toCssText(paragraphCss(BASIC_PARAGRAPH_PROPS, exportColors))).toMatch(/color: rgb\(10 10 10\)/);
  });
});

describe('runCss', () => {
  const styled = (): GalleyDocument => {
    let h: HistoryState = createHistory(doc0);
    h = applyCommand(h, addStyle, { kind: 'paragraph', style: { id: 'body', name: 'Body', basedOn: BASIC_PARAGRAPH_ID, shared: { tracking: 25 }, print: { fontSize: 10, leading: 13.5 }, web: {} } });
    h = applyCommand(h, addStyle, { kind: 'character', style: { id: 'caps', name: 'Caps', basedOn: null, shared: { textCase: 'allCaps', kerning: 'none' }, print: { baselineShift: 3 }, web: {} } });
    h = applyCommand(h, addStyle, { kind: 'character', style: { id: 'big', name: 'Big', basedOn: null, shared: {}, print: { fontSize: 20 }, web: {} } });
    return h.doc;
  };
  const run = (doc: GalleyDocument, marks: Parameters<typeof resolveRun>[2]) => {
    const p = resolveParagraphStyle(doc, 'body');
    return toCssText(runCss(p, resolveRun(doc, p, marks), colors));
  };

  it('an unmarked run, or one whose marks change nothing, has no style', () => {
    const doc = styled();
    expect(run(doc, undefined)).toBe('');
    expect(run(doc, [{ type: 'override', attrs: { print: { fontSize: 10 } } }])).toBe('');
  });

  it('a run carries only what differs from its paragraph', () => {
    const doc = styled();
    expect(run(doc, [{ type: 'override', attrs: { shared: { fontWeight: 700, fontStyle: 'italic' } } }])).toBe('font-weight: 700; font-style: italic');
    expect(run(doc, [{ type: 'override', attrs: { shared: { fontWeight: 700 }, print: { leading: 20 } } }])).toBe('font-weight: 700; line-height: 20pt');
    expect(run(doc, [{ type: 'override', attrs: { shared: { fill: paint('paper') } } }])).toBe(`color: ${colors.css(paint('paper'))}`);
  });

  it('character styles: case, kerning and baseline shift, and an override on top', () => {
    const doc = styled();
    expect(run(doc, [{ type: 'charStyle', attrs: { style: 'caps' } }])).toBe('font-kerning: none; text-transform: uppercase; position: relative; top: -3pt');
    expect(run(doc, [{ type: 'charStyle', attrs: { style: 'caps' } }, { type: 'override', attrs: { shared: { textCase: 'normal' } } }])).toBe('font-kerning: none; position: relative; top: -3pt');
  });

  it('a run with another size keeps tracking proportional to its own size, and can switch features and tracking off', () => {
    const doc = styled();
    expect(run(doc, [{ type: 'charStyle', attrs: { style: 'big' } }])).toBe('font-size: 20pt; letter-spacing: 0.025em');
    expect(run(doc, [{ type: 'override', attrs: { shared: { tracking: 0 } } }])).toBe('letter-spacing: normal');
    expect(run(doc, [{ type: 'override', attrs: { shared: { features: { onum: true } } } }])).toBe('font-feature-settings: "onum" 1');
    const p = resolveParagraph(doc, { style: 'body', overrides: { shared: { features: { liga: false } } } });
    expect(toCssText(runCss(p, resolveRun(doc, p, [{ type: 'override', attrs: { shared: { features: { liga: true } } } }]), colors))).toBe('font-feature-settings: "liga" 1');
  });
});

describe('PageView renders styled, formatted text', () => {
  it('draws paragraphs in their styles, runs with their marks, and only the first frame of a thread (until P2-02)', () => {
    let h = createHistory(doc0);
    h = applyCommand(h, addStyle, { kind: 'paragraph', style: { id: 'head', name: 'Head', basedOn: BASIC_PARAGRAPH_ID, shared: { fontWeight: 800 }, print: { fontSize: 30, leading: 36, align: 'center' }, web: {} } });
    h = applyCommand(h, addStyle, { kind: 'character', style: { id: 'em', name: 'Em', basedOn: null, shared: { fontStyle: 'italic' }, print: {}, web: {} } });
    const frame = (id: string, storyId: string) => ({ id, type: 'text' as const, name: '', layerId: 'layer_1', x: 0, y: 0, w: 100, h: 50, rotation: 0, fill: null, stroke: null, storyId, inset: 0 });
    h = applyCommand(h, addFrame, { frame: frame('t1', 's'), pageId: 'page_1', story: createStory('s', 'Title\nHello world', { style: 'head' }) });
    h = applyCommand(h, addFrame, { frame: frame('t2', 's2'), pageId: 'page_1', story: createStory('s2', '') });
    h = applyCommand(h, linkFrames, { fromId: 't1', toId: 't2' });
    h = applyCommand(h, applyCharacterStyle, { storyId: 's', range: { from: { paragraph: 1, offset: 0 }, to: { paragraph: 1, offset: 5 } }, styleId: 'em' });
    h = applyCommand(h, setTextOverrides, { storyId: 's', range: { from: { paragraph: 1, offset: 6 }, to: { paragraph: 1, offset: 11 } }, target: 'character', patch: { set: { shared: { fontWeight: 900 } } } });
    const host = document.createElement('div');
    host.innerHTML = renderToStaticMarkup(<PageView doc={h.doc} pageId="page_1" colorMode="screen" assetUrl={() => ''} />);
    const first = host.querySelector('[data-frame-id="t1"]')!;
    const second = host.querySelector('[data-frame-id="t2"]')!;
    expect([...first.querySelectorAll('p')].map((p) => p.getAttribute('data-paragraph-style'))).toEqual(['head', 'head']);
    const spans = [...first.querySelectorAll<HTMLElement>('p:nth-child(2) span')];
    expect(spans.map((s) => [s.textContent, s.getAttribute('style')])).toEqual([
      ['Hello', 'font-style:italic'],
      [' ', null],
      ['world', 'font-weight:900'],
    ]);
    expect(second.querySelectorAll('p')).toHaveLength(0);
  });
});

describe('usedFontFaces', () => {
  it('lists the resolved face of every paragraph and of every run a character style or override changes', () => {
    let h = createHistory(doc0);
    h = applyCommand(h, addStyle, { kind: 'paragraph', style: { id: 'head', name: 'Head', basedOn: BASIC_PARAGRAPH_ID, shared: { fontWeight: 800, fontFamily: 'Fraunces' }, print: {}, web: {} } });
    h = applyCommand(h, addStyle, { kind: 'character', style: { id: 'em', name: 'Em', basedOn: null, shared: { fontStyle: 'italic' }, print: {}, web: {} } });
    const frame = { id: 't', type: 'text' as const, name: '', layerId: 'layer_1', x: 0, y: 0, w: 100, h: 50, rotation: 0, fill: null, stroke: null, storyId: 's', inset: 0 };
    h = applyCommand(h, addFrame, { frame, pageId: 'page_1', story: createStory('s', 'Head\nBody\nMore', {}) });
    const at = (paragraph: number) => ({ from: { paragraph, offset: 0 }, to: { paragraph, offset: 2 } });
    h = applyCommand(h, setTextOverrides, { storyId: 's', range: at(0), target: 'paragraph', patch: { set: { shared: { fontFamily: 'Fraunces', fontWeight: 800 } } } });
    h = applyCommand(h, applyCharacterStyle, { storyId: 's', range: at(1), styleId: 'em' });
    h = applyCommand(h, setTextOverrides, { storyId: 's', range: at(2), target: 'character', patch: { set: { shared: { fontWeight: 900 } } } });
    expect(usedFontFaces(h.doc, 'page_1')).toEqual(['italic 400 16px "Inter"', 'normal 400 16px "Inter"', 'normal 800 16px "Fraunces"', 'normal 900 16px "Inter"']);
  });
});
