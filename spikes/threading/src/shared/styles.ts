// Paragraph styles: the single source of truth for both the CSS and the measurement code.
// All metrics are in pt. Leading, indents and spacing are multiples of 0.75pt (= whole CSS px) so that
// LayoutNG's 1/64px LayoutUnit arithmetic is exact and "n lines * leading" holds without drift.
// (See FINDINGS caveat: arbitrary leading such as 11pt = 14.667px accumulates sub-pixel error.)

export const PT = 4 / 3; // CSS px per pt

export interface ParaStyle {
  id: string;
  label: string;
  font: number; // font-size, pt
  leading: number; // fixed line height, pt
  weight: 400 | 700;
  italic: boolean;
  indent: number; // first-line indent, pt
  before: number; // space before, pt (ignored at top of a frame and on continued paragraphs)
  after: number; // space after, pt
  align: 'left' | 'justify';
  inset: number; // left/right inset, pt
}

export const STYLES: Record<string, ParaStyle> = {
  heading: { id: 'heading', label: 'Heading', font: 21, leading: 24, weight: 700, italic: false, indent: 0, before: 0, after: 9, align: 'left', inset: 0 },
  subhead: { id: 'subhead', label: 'Subhead', font: 11, leading: 13.5, weight: 700, italic: false, indent: 0, before: 9, after: 3, align: 'left', inset: 0 },
  body: { id: 'body', label: 'Body', font: 9, leading: 12, weight: 400, italic: false, indent: 12, before: 0, after: 4.5, align: 'justify', inset: 0 },
  quote: { id: 'quote', label: 'Quote', font: 10, leading: 13.5, weight: 400, italic: true, indent: 0, before: 6, after: 6, align: 'left', inset: 0 },
};
export const DEFAULT_STYLE = 'body';

export function styleOf(id: string): ParaStyle {
  return STYLES[id] ?? STYLES[DEFAULT_STYLE];
}

const px = (pt: number) => pt * PT;
export function isPxExact(pt: number): boolean {
  return Math.abs(px(pt) * 64 - Math.round(px(pt) * 64)) < 1e-9;
}

/** CSS for slots and paragraph styles. Injected once; used identically by the editor, the measurement host and print. */
export function buildCss(): string {
  const rules: string[] = [];
  rules.push(`
.slot { box-sizing: border-box; display: flow-root; margin: 0; padding: 0;
  font-family: "Inter", sans-serif; color: #111;
  white-space: pre-wrap; overflow-wrap: normal; word-break: normal;
  hyphens: auto; -webkit-hyphens: auto; font-kerning: normal; font-variant-ligatures: common-ligatures;
  position: absolute; }
.measure .slot { position: static; }
.nohyph .slot { hyphens: manual; -webkit-hyphens: manual; } /* class lives on <body> so the measurement host (outside #page) obeys it too */
.slot > p { margin: 0; box-sizing: border-box; }
`);
  for (const s of Object.values(STYLES)) {
    rules.push(`.slot > p.p-${s.id} { font-size: ${s.font}pt; line-height: ${s.leading}pt; font-weight: ${s.weight}; font-style: ${s.italic ? 'italic' : 'normal'};
  text-indent: ${s.indent}pt; padding: ${s.before}pt ${s.inset}pt ${s.after}pt ${s.inset}pt; text-align: ${s.align}; }`);
  }
  // continued paragraphs (first line of a slot that starts mid-paragraph): no indent, no space before
  rules.push(`.slot > p.cont { text-indent: 0; padding-top: 0; }`);
  // space before is dropped at the top of a frame (InDesign default)
  rules.push(`.slot > p:first-of-type { padding-top: 0; }`);
  // invisible floats that wrap text around image frames: they affect layout only (shape-outside is inline)
  rules.push(`.slot > .wrap { visibility: hidden; pointer-events: none; margin-left: 0; margin-right: 0; margin-bottom: 0; }`);
  // a paragraph that continues in the next slot: its last line is a "middle" line, so justify it
  for (const s of Object.values(STYLES)) {
    if (s.align === 'justify') rules.push(`.slot > p.p-${s.id}.cn, .slot > p.p-${s.id}.hy { text-align-last: justify; }`);
  }
  // a paragraph that ends mid-word at a slot boundary: draw the hyphen the engine would have drawn (U+2010)
  rules.push(`.slot > p.hy::after { content: "\\2010"; }`);
  rules.push(`.slot strong { font-weight: 700; } .slot em { font-style: italic; }`);
  // trailing spaces of a continued piece hang outside the justified last line (see StoryEditor.hangDecorations)
  rules.push(`.slot .hang { word-spacing: -100%; }`);
  return rules.join('\n');
}
