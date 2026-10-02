// @vitest-environment jsdom
import {
  addStyle,
  applyCommand,
  BASIC_PARAGRAPH_ID,
  charStyleMark,
  createDocument,
  createHistory,
  overrideMark,
  paragraphNode,
  storyDocFromText,
  storyDocProblem,
  styledParagraph,
  textNode,
  type GalleyDocument,
  type PMNode,
} from '@galley/model';
import { describe, expect, it } from 'vitest';
import { docToEditable, editableToDoc } from './dom';

const html = (markup: string): HTMLElement => {
  const el = document.createElement('div');
  el.innerHTML = markup;
  return el;
};
/** `[text, override JSON]` per run: what a run's marks say, compactly. */
const paragraphs = (doc: PMNode) => (doc.content ?? []).map((p) => (p.content ?? []).map((t) => [t.text, (t.marks ?? []).map((m) => (m.type === 'override' ? JSON.stringify(m.attrs) : `${m.type}:${m.attrs?.style}`)).join('+')]));

const bold = overrideMark({ shared: { fontWeight: 700 } });
const italic = overrideMark({ shared: { fontStyle: 'italic' } });
const boldItalic = overrideMark({ shared: { fontWeight: 700, fontStyle: 'italic' } });

/** A document with a Body style (10 pt, weight 400), a bold Heading style (weight 700) and a Strong character style. */
function styledDoc(): GalleyDocument {
  let h = createHistory(createDocument({ engineVersion: '44.5.1' }));
  h = applyCommand(h, addStyle, { kind: 'paragraph', style: { id: 'body', name: 'Body', basedOn: BASIC_PARAGRAPH_ID, shared: {}, print: { fontSize: 10, leading: 13.5, align: 'justify' }, web: {} } });
  h = applyCommand(h, addStyle, { kind: 'paragraph', style: { id: 'heading', name: 'Heading', basedOn: BASIC_PARAGRAPH_ID, shared: { fontWeight: 700 }, print: { fontSize: 20, leading: 24 }, web: {} } });
  h = applyCommand(h, addStyle, { kind: 'character', style: { id: 'strong', name: 'Strong', basedOn: null, shared: { fontWeight: 700 }, print: {}, web: {} } });
  return h.doc;
}

describe('editableToDoc', () => {
  it('reads paragraphs as [Basic Paragraph] paragraphs', () => {
    expect(editableToDoc(html('<p>Hello</p><p>World</p>'))).toEqual({ type: 'doc', content: [paragraphNode('Hello'), paragraphNode('World')] });
  });

  it('reads an empty editable as one empty paragraph', () => {
    expect(editableToDoc(html(''))).toEqual({ type: 'doc', content: [paragraphNode()] });
    expect(editableToDoc(html('<p><br></p>'))).toEqual({ type: 'doc', content: [paragraphNode()] });
  });

  it('keeps empty paragraphs between text', () => {
    expect(editableToDoc(html('<p>a</p><p><br></p><p>b</p>')).content).toHaveLength(3);
  });

  it('reads bare text and divs the browser may produce', () => {
    expect(paragraphs(editableToDoc(html('Hello<div>World</div>')))).toEqual([[['Hello', '']], [['World', '']]]);
  });

  it('reads strong and em runs as weight and italic overrides, merging neighbors with the same marks', () => {
    const doc = editableToDoc(html('<p>a <strong>bold</strong><strong> more</strong> <em>it</em><b><i>both</i></b></p>'));
    expect(paragraphs(doc)).toEqual([
      [
        ['a ', ''],
        ['bold more', '{"shared":{"fontWeight":700}}'],
        [' ', ''],
        ['it', '{"shared":{"fontStyle":"italic"}}'],
        ['both', '{"shared":{"fontWeight":700,"fontStyle":"italic"}}'],
      ],
    ]);
    expect(storyDocProblem(doc)).toBeNull();
  });

  it('ignores styled spans and normalizes non-breaking spaces', () => {
    expect(paragraphs(editableToDoc(html('<p><span style="font-weight: 700">a&nbsp;b</span></p>')))).toEqual([[['a b', '']]]);
  });

  it('treats a <br> inside a paragraph as a break and a trailing one as a placeholder', () => {
    expect(paragraphs(editableToDoc(html('<p>one<br>two</p>')))).toEqual([[['one', '']], [['two', '']]]);
    expect(paragraphs(editableToDoc(html('<p>one<br></p>')))).toEqual([[['one', '']]]);
    expect(editableToDoc(html('<p>one<br><br></p>')).content).toHaveLength(2);
  });

  it('splits literal newlines into paragraphs', () => {
    expect(paragraphs(editableToDoc(html('<p>a\nb</p>')))).toEqual([[['a', '']], [['b', '']]]);
  });

  it('flattens nested blocks', () => {
    expect(paragraphs(editableToDoc(html('<div><p>a</p><p>b</p></div>')))).toEqual([[['a', '']], [['b', '']]]);
  });

  it('keeps each paragraph\'s style and local overrides, and a paragraph without them inherits the one before', () => {
    const doc = editableToDoc(html(`<p data-pstyle="body" data-poverrides='{"print":{"align":"center"}}'>a</p><p>typed after Enter</p><p data-pstyle="heading">c</p><div>d</div>`));
    expect((doc.content ?? []).map((p) => p.attrs)).toEqual([{ style: 'body', overrides: { print: { align: 'center' } } }, { style: 'body', overrides: { print: { align: 'center' } } }, { style: 'heading' }, { style: 'heading' }]);
    expect(storyDocProblem(doc)).toBeNull();
  });

  it('keeps the marks stored on a run\'s span, including a character style and overrides the editor does not know', () => {
    const marks = JSON.stringify([charStyleMark('strong'), overrideMark({ print: { fontSize: 14 }, shared: { tracking: 20 } })]);
    const doc = editableToDoc(html(`<p data-pstyle="body">a <span data-marks='${marks}'><strong>typed in the span</strong></span> b</p>`), styledDoc());
    expect(paragraphs(doc)).toEqual([
      [
        ['a ', ''],
        ['typed in the span', 'charStyle:strong+{"shared":{"tracking":20},"print":{"fontSize":14}}'],
        [' b', ''],
      ],
    ]);
  });

  it('bold toggling: a run bold by an override is un-bolded when its <strong> is removed, and one bold by a character style gets an explicit regular weight', () => {
    const tables = styledDoc();
    const overrideBold = JSON.stringify([overrideMark({ shared: { fontWeight: 900 } })]);
    const keeps = editableToDoc(html(`<p data-pstyle="body"><span data-marks='${overrideBold}'><strong>kept</strong></span></p>`), tables);
    expect(paragraphs(keeps)[0]![0]![1]).toBe('{"shared":{"fontWeight":900}}'); // still bold: the 900 the model had is not replaced by 700
    const removed = editableToDoc(html(`<p data-pstyle="body"><span data-marks='${overrideBold}'>plain now</span></p>`), tables);
    expect(paragraphs(removed)).toEqual([[['plain now', '']]]);
    const styleBold = JSON.stringify([charStyleMark('strong')]);
    const regular = editableToDoc(html(`<p data-pstyle="body"><span data-marks='${styleBold}'>plain now</span></p>`), tables);
    expect(paragraphs(regular)).toEqual([[['plain now', 'charStyle:strong+{"shared":{"fontWeight":400}}']]]);
    // bold text in a bold paragraph: strong is one step up (900)
    const heading = editableToDoc(html('<p data-pstyle="heading">x <strong>y</strong></p>'), tables);
    expect(paragraphs(heading)).toEqual([[['x ', ''], ['y', '{"shared":{"fontWeight":900}}']]]);
  });

  it('italic toggling mirrors bold', () => {
    const tables = styledDoc();
    const marks = JSON.stringify([italic]);
    expect(paragraphs(editableToDoc(html(`<p data-pstyle="body"><span data-marks='${marks}'>plain</span></p>`), tables))).toEqual([[['plain', '']]]);
    expect(paragraphs(editableToDoc(html(`<p data-pstyle="body"><span data-marks='${marks}'><em>slanted</em></span></p>`), tables))).toEqual([[['slanted', '{"shared":{"fontStyle":"italic"}}']]]);
  });
});

describe('docToEditable', () => {
  const tables = styledDoc();

  it('round-trips a story: styles, overrides, character styles, bold and italic runs, empty paragraphs', () => {
    const doc: PMNode = {
      type: 'doc',
      content: [
        styledParagraph({ style: 'body' }, 'Plain ', textNode('bold', [bold]), ' ', textNode('italic', [italic]), ' ', textNode('both', [boldItalic])),
        paragraphNode(),
        styledParagraph({ style: 'heading', overrides: { print: { align: 'center' } } }, textNode('Styled ', [charStyleMark('strong')]), textNode('heavy', [overrideMark({ shared: { fontWeight: 900 }, print: { fontSize: 30 } })])),
        styledParagraph({ style: 'body' }, textNode('mixed', [charStyleMark('strong'), italic])),
      ],
    };
    expect(storyDocProblem(doc)).toBeNull();
    const el = document.createElement('div');
    docToEditable(el, doc, tables);
    expect(editableToDoc(el, tables)).toEqual(doc);
    // the DOM carries the style and the typography the page draws, and bold and italic as tags the browser's commands understand
    const first = el.querySelector('p')!;
    expect(first.getAttribute('data-pstyle')).toBe('body');
    expect(first.style.fontSize).toBe('10pt');
    expect(first.style.textAlign).toBe('justify');
    expect(first.querySelector('strong')!.textContent).toBe('bold');
    expect(first.querySelector('em')!.textContent).toBe('italic');
    expect(first.querySelector('span[data-marks]')!.getAttribute('style')).toContain('font-weight: 700');
    expect(el.querySelectorAll('p')[2]!.getAttribute('data-poverrides')).toBe('{"print":{"align":"center"}}');
  });

  it('round-trips plain stories', () => {
    const doc = storyDocFromText('Hello\n\nWorld');
    const el = document.createElement('div');
    docToEditable(el, doc, tables);
    expect(editableToDoc(el, tables)).toEqual(doc);
  });

  it('writes no color into the editable (its text is transparent; the page draws the colors)', () => {
    const el = document.createElement('div');
    docToEditable(el, { type: 'doc', content: [styledParagraph({ style: 'body' }, 'x', textNode('y', [overrideMark({ shared: { fill: { swatchId: 'paper', tint: 100, overprint: false } } })]))] }, tables);
    expect(el.innerHTML).not.toMatch(/rgb\(|#[0-9a-f]{3,6}/i);
  });

  it('survives a story whose style has gone missing, unstyled', () => {
    const el = document.createElement('div');
    docToEditable(el, storyDocFromText('x', { style: 'ghost' }), tables);
    expect(el.querySelector('p')!.getAttribute('data-pstyle')).toBe('ghost');
    expect(editableToDoc(el, tables).content![0]!.attrs).toEqual({ style: 'ghost' });
  });
});
