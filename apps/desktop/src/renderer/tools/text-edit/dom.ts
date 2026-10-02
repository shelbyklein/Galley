/**
 * Plain in-place text editing for Phase 1: a contenteditable element holds `<p>` paragraphs with `<strong>` and `<em>`
 * runs, and these two functions convert between that DOM and the story's ProseMirror JSON (`doc > paragraph* > text*` with
 * `strong` and `em` marks, the Phase 1 story schema). Phase 2 replaces all of this with a ProseMirror editing view.
 *
 * `editableToDoc` is tolerant of what browsers do to a contenteditable (bare text at the root, `<div>` instead of `<p>`,
 * `<br>` placeholders in empty lines, `&nbsp;`, styled `<span>`s); only block structure, `<br>` line breaks, text, and the
 * tags b/strong and i/em survive. Tests in dom.test.ts (jsdom).
 */
import { paragraphNode, textNode, type PMNode } from '@galley/model';

type Mark = 'strong' | 'em';

const BLOCKS = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'UL', 'OL', 'BLOCKQUOTE', 'PRE', 'SECTION', 'ARTICLE']);

/** Canonical mark order, as a ProseMirror schema ranks them (strong, then em). */
const RANK: Record<Mark, number> = { strong: 0, em: 1 };

const markOf = (tag: string): Mark | null => (tag === 'STRONG' || tag === 'B' ? 'strong' : tag === 'EM' || tag === 'I' ? 'em' : null);

const hasBlockChild = (el: Element): boolean => Array.from(el.children).some((c) => BLOCKS.has(c.tagName));

class Builder {
  paragraphs: PMNode[] = [];
  /** The open paragraph's runs, or null when no paragraph is open. */
  runs: PMNode[] | null = null;

  open(): void {
    this.runs ??= [];
  }

  /** Close the open paragraph (if any). */
  close(): void {
    if (this.runs === null) return;
    this.paragraphs.push(paragraphNode(...this.runs));
    this.runs = null;
  }

  text(value: string, marks: readonly Mark[]): void {
    const parts = value.replace(/ /g, ' ').replace(/[​﻿]/g, '').replace(/\r\n?/g, '\n').split('\n');
    parts.forEach((part, i) => {
      if (i > 0) {
        this.open();
        this.close();
      }
      if (part === '') return;
      this.open();
      const last = this.runs![this.runs!.length - 1];
      const sameMarks = last && JSON.stringify(last.marks?.map((m) => m.type) ?? []) === JSON.stringify(marks);
      if (last && sameMarks) last.text = (last.text ?? '') + part;
      else this.runs!.push(textNode(part, marks));
    });
  }
}

function walk(parent: Node, marks: readonly Mark[], b: Builder): void {
  const children = Array.from(parent.childNodes);
  children.forEach((node, index) => {
    if (node.nodeType === 3) {
      b.text(node.nodeValue ?? '', marks);
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as Element;
    if (el.tagName === 'BR') {
      // a <br> that ends its block is the browser's placeholder for an empty line, not a line break
      const trailing = children.slice(index + 1).every((n) => n.nodeType === 3 && (n.nodeValue ?? '') === '');
      if (trailing) b.open();
      else {
        b.open();
        b.close();
      }
      return;
    }
    if (BLOCKS.has(el.tagName)) {
      b.close();
      if (hasBlockChild(el)) {
        walk(el, marks, b);
        b.close();
      } else {
        b.open();
        walk(el, marks, b);
        b.close();
      }
      return;
    }
    const mark = markOf(el.tagName);
    walk(el, mark && !marks.includes(mark) ? [...marks, mark].sort((a, c) => RANK[a] - RANK[c]) : marks, b);
  });
}

/** The story document the editable's content represents. Always at least one paragraph. */
export function editableToDoc(root: HTMLElement): PMNode {
  const b = new Builder();
  walk(root, [], b);
  b.close();
  if (b.paragraphs.length === 0) b.paragraphs.push(paragraphNode());
  return { type: 'doc', content: b.paragraphs };
}

/** Fill the editable from a story document (replacing what it holds). */
export function docToEditable(root: HTMLElement, doc: PMNode): void {
  const d = root.ownerDocument;
  const paragraphs = (doc.content ?? []).map((p) => {
    const el = d.createElement('p');
    const runs = p.content ?? [];
    if (runs.length === 0) el.appendChild(d.createElement('br'));
    for (const run of runs) {
      let node: Node = d.createTextNode(run.text ?? '');
      for (const mark of [...(run.marks ?? [])].reverse()) {
        const wrapper = d.createElement(mark.type === 'strong' ? 'strong' : 'em');
        wrapper.appendChild(node);
        node = wrapper;
      }
      el.appendChild(node);
    }
    return el;
  });
  root.replaceChildren(...paragraphs);
}
