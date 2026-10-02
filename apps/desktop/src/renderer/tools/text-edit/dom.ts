/**
 * Plain in-place text editing for Phase 1 and 2 (until the ProseMirror view of P2-03): a contenteditable element holds `<p>`
 * paragraphs, and these two functions convert between that DOM and the story's ProseMirror JSON (`doc > paragraph* > text*`,
 * see packages/model/src/text/story.ts). Phase 2 replaces all of this with a ProseMirror editing view.
 *
 * What the editable carries so that editing never loses formatting:
 *   - a paragraph is `<p data-pstyle="<style id>" data-poverrides="<overrides JSON>">`, with the paragraph's resolved CSS inline
 *     (so the caret and selection line up with the page underneath; the editable's text itself is transparent). The browser
 *     copies a paragraph's attributes when Enter splits it, and a paragraph that has none inherits the previous one's.
 *   - a run with marks is `<span data-marks="<marks JSON>">` with the run's CSS inline. The marks are the truth for everything
 *     except bold and italic, which the browser's own commands change: a run that is heavier than its paragraph is also wrapped
 *     in `<strong>`, an italic one in `<em>` (both neutralized with inline styles, because the span already carries the
 *     weight), and when the DOM and the marks disagree after an edit, the DOM wins (Cmd-B on a run adds a weight override one
 *     step bolder than the paragraph, removing the `<strong>` takes it away).
 *   - `<b>`, `<strong>`, `<i>` and `<em>` the browser creates are read as that bold and italic.
 *
 * `editableToDoc` is tolerant of what browsers do to a contenteditable (bare text at the root, `<div>` instead of `<p>`,
 * `<br>` placeholders in empty lines, `&nbsp;`, styled `<span>`s); only block structure, `<br>` line breaks, text, the data
 * attributes above and the tags b/strong and i/em survive. Tests in dom.test.ts (jsdom).
 */
import {
  BASIC_PARAGRAPH_ID,
  bolderWeight,
  builtinCharacterStyles,
  builtinParagraphStyles,
  normalizeStoryDoc,
  paragraphAttrs,
  patchOverrides,
  resolveParagraph,
  resolveRun,
  styledParagraph,
  textNode,
  type CharacterOverrides,
  type ParagraphAttrs,
  type ParagraphOverrides,
  type PMMark,
  type PMNode,
  type ResolvedParagraph,
  type StyleTables,
} from '@galley/model';
import { paragraphCss, runCss, type ColorResolver } from '@galley/render';

/** The editable's text is transparent (the page draws it), so no document color is ever written into it. */
const TRANSPARENT: ColorResolver = { mode: 'screen', css: () => 'transparent' };

const DEFAULT_TABLES: StyleTables = { paragraphStyles: builtinParagraphStyles(), characterStyles: builtinCharacterStyles() };

const BLOCKS = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'UL', 'OL', 'BLOCKQUOTE', 'PRE', 'SECTION', 'ARTICLE']);

const hasBlockChild = (el: Element): boolean => Array.from(el.children).some((c) => BLOCKS.has(c.tagName));

function parseJson<T>(text: string | null): T | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function readParagraphAttrs(el: Element): ParagraphAttrs | null {
  const style = el.getAttribute('data-pstyle');
  if (!style) return null;
  const overrides = parseJson<ParagraphOverrides>(el.getAttribute('data-poverrides'));
  return overrides ? { style, overrides } : { style };
}

/** What the DOM around a piece of text says about it: the stored marks of its span, and bold and italic from the tags. */
interface Context {
  marks: PMMark[];
  bold: boolean;
  italic: boolean;
}

const sameMarks = (a: readonly PMMark[], b: readonly PMMark[]) => JSON.stringify(a) === JSON.stringify(b);

class Builder {
  paragraphs: PMNode[] = [];
  /** The open paragraph's runs, or null when no paragraph is open. */
  runs: PMNode[] | null = null;
  /** The open paragraph's style and overrides; the next paragraph without its own inherits the last one's. */
  attrs: ParagraphAttrs = { style: BASIC_PARAGRAPH_ID };

  constructor(private readonly tables: StyleTables) {}

  open(attrs?: ParagraphAttrs | null): void {
    if (this.runs === null) {
      this.runs = [];
      if (attrs) this.attrs = attrs;
    }
  }

  /** Close the open paragraph (if any). */
  close(): void {
    if (this.runs === null) return;
    this.paragraphs.push(styledParagraph(this.attrs, ...this.runs));
    this.runs = null;
  }

  private base(): ResolvedParagraph | null {
    try {
      return resolveParagraph(this.tables, this.attrs);
    } catch {
      return null; // a style that no longer exists: treat bold and italic against the basic paragraph
    }
  }

  /** The marks a piece of text has once the DOM's bold and italic are reconciled with the stored marks. */
  private marksFor(ctx: Context): PMMark[] {
    const base = this.base();
    const weight = base?.fontWeight ?? 400;
    const italic = base?.fontStyle === 'italic';
    let run = base;
    try {
      run = base ? resolveRun(this.tables, base, ctx.marks) : null;
    } catch {
      run = base;
    }
    const wasBold = (run?.fontWeight ?? weight) > weight;
    const wasItalic = run?.fontStyle === 'italic' && !italic;
    let marks = ctx.marks;
    const change = (patch: Parameters<typeof patchOverrides<CharacterOverrides>>[1]) => {
      const current = marks.find((m) => m.type === 'override')?.attrs as CharacterOverrides | undefined;
      const next = patchOverrides(current, patch);
      marks = [...marks.filter((m) => m.type !== 'override'), ...(next ? [{ type: 'override', attrs: next as unknown as PMMark['attrs'] }] : [])];
    };
    if (ctx.bold && !wasBold) change({ set: { shared: { fontWeight: bolderWeight(weight) } } });
    if (!ctx.bold && wasBold) {
      change({ unset: { shared: ['fontWeight'] } });
      const still = base ? resolveRun(this.tables, base, marks).fontWeight : weight;
      if (still !== weight) change({ set: { shared: { fontWeight: weight } } }); // the character style is the bold: say regular explicitly
    }
    if (ctx.italic && !wasItalic && !italic) change({ set: { shared: { fontStyle: 'italic' } } });
    if (!ctx.italic && wasItalic) {
      change({ unset: { shared: ['fontStyle'] } });
      const still = base ? resolveRun(this.tables, base, marks).fontStyle : 'normal';
      if (still === 'italic') change({ set: { shared: { fontStyle: 'normal' } } });
    }
    return marks;
  }

  text(value: string, ctx: Context): void {
    const parts = value.replace(/\u00a0/g, ' ').replace(/[\u200b\ufeff]/g, '').replace(/\r\n?/g, '\n').split('\n');
    parts.forEach((part, i) => {
      if (i > 0) {
        this.open();
        this.close();
      }
      if (part === '') return;
      this.open();
      const marks = this.marksFor(ctx);
      const last = this.runs![this.runs!.length - 1];
      if (last && sameMarks(last.marks ?? [], marks)) last.text = (last.text ?? '') + part;
      else this.runs!.push(textNode(part, marks));
    });
  }
}

function walk(parent: Node, ctx: Context, b: Builder): void {
  const children = Array.from(parent.childNodes);
  children.forEach((node, index) => {
    if (node.nodeType === 3) {
      b.text(node.nodeValue ?? '', ctx);
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
      const attrs = readParagraphAttrs(el);
      if (hasBlockChild(el)) {
        walk(el, ctx, b);
        b.close();
      } else {
        b.open(attrs);
        walk(el, ctx, b);
        b.close();
      }
      return;
    }
    let next = ctx;
    const stored = el.tagName === 'SPAN' ? parseJson<PMMark[]>(el.getAttribute('data-marks')) : null;
    if (stored) next = { ...ctx, marks: stored };
    if (el.tagName === 'STRONG' || el.tagName === 'B') next = { ...next, bold: true };
    if (el.tagName === 'EM' || el.tagName === 'I') next = { ...next, italic: true };
    walk(el, next, b);
  });
}

/** The story document the editable's content represents. Always at least one paragraph, and always in canonical form. */
export function editableToDoc(root: HTMLElement, tables: StyleTables = DEFAULT_TABLES): PMNode {
  const b = new Builder(tables);
  walk(root, { marks: [], bold: false, italic: false }, b);
  b.close();
  return normalizeStoryDoc({ type: 'doc', content: b.paragraphs.length > 0 ? b.paragraphs : [styledParagraph(b.attrs)] });
}

/** Fill the editable from a story document (replacing what it holds). */
export function docToEditable(root: HTMLElement, doc: PMNode, tables: StyleTables = DEFAULT_TABLES): void {
  const d = root.ownerDocument;
  const paragraphs = (doc.content ?? []).map((p, i) => {
    const attrs = paragraphAttrs(p);
    const el = d.createElement('p');
    el.setAttribute('data-pstyle', attrs.style);
    if (attrs.overrides) el.setAttribute('data-poverrides', JSON.stringify(attrs.overrides));
    let resolved: ResolvedParagraph | null = null;
    try {
      resolved = resolveParagraph(tables, attrs);
      Object.assign(el.style, paragraphCss(resolved, TRANSPARENT, { dropSpaceBefore: i === 0 }));
      el.lang = resolved.language;
    } catch {
      // a style that no longer exists: the editable stays unstyled until the story is fixed
    }
    const runs = p.content ?? [];
    if (runs.length === 0) el.appendChild(d.createElement('br'));
    for (const run of runs) {
      let node: Node = d.createTextNode(run.text ?? '');
      const marks = run.marks ?? [];
      if (marks.length > 0 && resolved) {
        const r = resolveRun(tables, resolved, marks);
        if (r.fontWeight > resolved.fontWeight) node = wrap(d, 'strong', node, { fontWeight: 'inherit' });
        if (r.fontStyle === 'italic' && resolved.fontStyle !== 'italic') node = wrap(d, 'em', node, { fontStyle: 'inherit' });
        const span = d.createElement('span');
        span.setAttribute('data-marks', JSON.stringify(marks));
        Object.assign(span.style, runCss(resolved, r, TRANSPARENT));
        span.appendChild(node);
        node = span;
      }
      el.appendChild(node);
    }
    return el;
  });
  root.replaceChildren(...paragraphs);
}

function wrap(d: Document, tag: 'strong' | 'em', child: Node, style: Partial<CSSStyleDeclaration>): Node {
  const el = d.createElement(tag);
  Object.assign(el.style, style);
  el.appendChild(child);
  return el;
}
