// @vitest-environment jsdom
import { paragraphNode, storyDocFromText, textNode, type PMNode } from '@galley/model';
import { describe, expect, it } from 'vitest';
import { docToEditable, editableToDoc } from './dom';

const html = (markup: string): HTMLElement => {
  const el = document.createElement('div');
  el.innerHTML = markup;
  return el;
};
const paragraphs = (doc: PMNode) => (doc.content ?? []).map((p) => (p.content ?? []).map((t) => [t.text, (t.marks ?? []).map((m) => m.type).join('+')]));

describe('editableToDoc', () => {
  it('reads paragraphs', () => {
    expect(editableToDoc(html('<p>Hello</p><p>World</p>'))).toEqual({ type: 'doc', content: [paragraphNode('Hello'), paragraphNode('World')] });
  });

  it('reads an empty editable as one empty paragraph', () => {
    expect(editableToDoc(html(''))).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
    expect(editableToDoc(html('<p><br></p>'))).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
  });

  it('keeps empty paragraphs between text', () => {
    expect(editableToDoc(html('<p>a</p><p><br></p><p>b</p>')).content).toHaveLength(3);
  });

  it('reads bare text and divs the browser may produce', () => {
    expect(paragraphs(editableToDoc(html('Hello<div>World</div>')))).toEqual([[['Hello', '']], [['World', '']]]);
  });

  it('reads strong and em runs, merging neighbors with the same marks', () => {
    const doc = editableToDoc(html('<p>a <strong>bold</strong><strong> more</strong> <em>it</em><b><i>both</i></b></p>'));
    expect(paragraphs(doc)).toEqual([[['a ', ''], ['bold more', 'strong'], [' ', ''], ['it', 'em'], ['both', 'strong+em']]]);
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
});

describe('docToEditable', () => {
  it('round-trips a story document, marks and empty paragraphs included', () => {
    const doc: PMNode = { type: 'doc', content: [paragraphNode('Plain ', textNode('bold', ['strong']), ' ', textNode('italic', ['em'])), paragraphNode(), paragraphNode(textNode('both', ['strong', 'em']))] };
    const el = document.createElement('div');
    docToEditable(el, doc);
    expect(el.innerHTML).toBe('<p>Plain <strong>bold</strong> <em>italic</em></p><p><br></p><p><strong><em>both</em></strong></p>');
    const back = editableToDoc(el);
    expect(back).toEqual(doc);
  });

  it('round-trips plain stories', () => {
    const doc = storyDocFromText('Hello\n\nWorld');
    const el = document.createElement('div');
    docToEditable(el, doc);
    expect(editableToDoc(el)).toEqual(doc);
  });
});
