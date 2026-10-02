// Sample story copy and builders. Mini-markup: "H|", "S|", "B|", "Q|" = heading/subhead/body/quote paragraph;
// **bold** and _italic_ inline.
import { Fragment, Node } from 'prosemirror-model';
import { schema } from './schema';

export const BASE_COPY: string[] = [
  'H|Setting Type in the Age of the Screen',
  'B|Every page we read was once a problem of **arrangement**. Before a single letter reached the paper, someone had to decide how wide the column would be, where each line would end, and what to do when a word refused to fit. Those decisions have not gone away. They have simply moved from the compositor\'s stick to the software on our desks, and they matter as much today as they did in a Mainz workshop five centuries ago.',
  'S|The Compositor\'s Stick',
  'B|A compositor working in the nineteenth century carried a small metal tray called a **stick**, and in it he assembled each line of type letter by letter, from left to right, upside down and backwards. Spacing material of several thicknesses sat beside the letters. When a line came up short, he widened the spaces between words; when it ran long, he squeezed them or broke a word at a syllable. Hyphenation was therefore a craft judgment, made one line at a time, by someone who had to live with the consequences when the forme was locked up and the press began to run.',
  'B|The rules he followed were practical rather than mystical. Avoid stacking hyphens on consecutive lines. Never leave a single short syllable alone at the end of a paragraph. Keep the gaps between words as even as the measure allows, and treat a visible river of white space running down the page as a defect to be corrected before anything is printed. _None of this was written into law_, but every apprentice learned it, because a page that broke these habits looked wrong even to readers who could not say why.',
  'S|When the Screen Took Over',
  'B|The arrival of the personal computer promised to make all of this automatic. A program could measure a word in an instant, consult a dictionary of break points, and fill a column faster than any human hand. Early results were disappointing. Lines were assembled one at a time with no regard for their neighbours, and the gaps in justified text swelled and shrank without any sense of rhythm. Designers who cared about the texture of a page learned to distrust the defaults and to correct the output by hand, paragraph by paragraph.',
  'S|Threads Between Frames',
  'B|A printed brochure is rarely a single column. A story begins in one block of text, runs down the side of a photograph, and continues in a second block somewhere else on the sheet, sometimes on another page entirely. Designers call this a **thread**. The text belongs to the story, not to any one frame, and the frames are simply windows through which the story is displayed. If an editor adds a sentence to the first frame, the last line of that frame must slide into the second, and the last line of the second into the third, so that nothing is lost and nothing is repeated at the joins.',
  'B|Getting this right is mostly a matter of **honest measurement**. The only trustworthy answer to the question of how many lines fit in a frame is to set the text at that frame\'s width, with that frame\'s font, and count. Estimates drift. A word that fits by a hair on a screen can wrap in the printed file, and a headline that looked tidy on a laptop can spill onto the next column at the printer. _The cure is to use one engine for both jobs_ and to refuse to guess.',
  'B|Hyphenation makes the problem more interesting. When a frame ends in the middle of a word, the first half must carry its hyphen and the second half must begin the next frame cleanly, with no indent, no extra space above it, and no duplicate letters. Readers should never be able to tell where one frame stopped and another began, except by the red mark that tells the designer the text has run out of room.',
  'S|Why It Matters',
  'B|Production work is unforgiving. A flyer is approved on Friday, plates are made on Monday, and a few thousand copies come off the press on Tuesday. If a line that fitted on the proof does not fit on the sheet, the mistake is discovered after the ink has dried. Designers therefore want a tool whose preview and whose output agree to the last character. They do not want an approximation of the page; they want the page itself.',
  'B|None of this is new in spirit. The compositor also measured, adjusted and measured again, and the discipline he practised is the same one a modern layout program has to automate. The tools have changed. The goal has not: a column of text that reads easily, ends where it should, and looks as though it could not have been set any other way.',
];

const STYLE_BY_PREFIX: Record<string, string> = { H: 'heading', S: 'subhead', B: 'body', Q: 'quote' };

export function parseInline(src: string): Node[] {
  const out: Node[] = [];
  const re = /(\*\*[^*]+\*\*|_[^_]+_)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  const push = (text: string, mark?: 'strong' | 'em') => {
    if (!text) return;
    out.push(schema.text(text, mark ? [schema.marks[mark].create()] : undefined));
  };
  while ((m = re.exec(src))) {
    push(src.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('**')) push(tok.slice(2, -2), 'strong');
    else push(tok.slice(1, -1), 'em');
    last = m.index + tok.length;
  }
  push(src.slice(last));
  return out;
}

export function buildStory(lines: string[]): Node {
  const paras = lines.map((l) => {
    const i = l.indexOf('|');
    const style = STYLE_BY_PREFIX[l.slice(0, i)] ?? 'body';
    return schema.nodes.paragraph.create({ style }, parseInline(l.slice(i + 1)));
  });
  return schema.nodes.doc.create(null, Fragment.from(paras));
}

export function countWords(s: string): number {
  const m = s.match(/\S+/g);
  return m ? m.length : 0;
}

export function plainOf(lines: string[]): string {
  return lines.map((l) => l.slice(l.indexOf('|') + 1).replace(/\*\*/g, '').replace(/_/g, '')).join('\n');
}

// --- long story (benchmark (b)): deterministic re-mix of the base copy's sentences ---
export function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildLongCopy(targetWords: number, seed = 7): string[] {
  const rnd = mulberry32(seed);
  const sentences: string[] = [];
  const subheads: string[] = [];
  for (const l of BASE_COPY) {
    const i = l.indexOf('|');
    const t = l[0];
    const body = l.slice(i + 1);
    if (t === 'B') sentences.push(...(body.match(/[^.!?]+[.!?]+(?:\s+|$)/g) ?? [body]).map((s) => s.trim()));
    else if (t === 'S') subheads.push(body);
  }
  const out: string[] = ['H|Long Chain: Setting Type, Revisited'];
  let words = 0;
  let paraCount = 0;
  while (words < targetWords) {
    if (paraCount % 7 === 0) out.push('S|' + subheads[Math.floor(rnd() * subheads.length)] + ' ' + (paraCount / 7 + 1));
    const n = 3 + Math.floor(rnd() * 4);
    const parts: string[] = [];
    for (let k = 0; k < n; k++) parts.push(sentences[Math.floor(rnd() * sentences.length)]);
    const p = parts.join(' ');
    out.push('B|' + p);
    words += countWords(p);
    paraCount++;
  }
  return out;
}
