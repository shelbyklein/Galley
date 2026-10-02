// Content-stream tokenizer. Works on a latin1 "binary string" (1 char = 1 byte) so raw byte
// ranges can be copied through untouched; only operators we choose to rewrite are re-emitted.
//
// Handles: comments, numbers, names (with #xx), literal strings (nested parens, escapes,
// line continuations), hex strings, arrays, dicts, operators (incl. ' " * variants) and
// inline images (BI ... ID <binary> EI) whose data may contain arbitrary bytes, including "EI".

export type Operand =
  | { kind: 'num'; value: number; start: number; end: number }
  | { kind: 'name'; value: string; start: number; end: number } // value is the decoded name without '/'
  | { kind: 'string'; start: number; end: number } // literal or hex, raw text only
  | { kind: 'array'; items: Operand[]; start: number; end: number }
  | { kind: 'dict'; entries: Map<string, Operand>; start: number; end: number }
  | { kind: 'bool' | 'null'; start: number; end: number };

export interface Op {
  operator: string;
  operands: Operand[];
  /** first byte of the first operand (or of the operator if none) */
  start: number;
  /** one past the last byte of the operator (for BI: one past EI) */
  end: number;
  /** for BI: parsed dict + raw data byte range */
  inline?: { dict: Map<string, Operand>; dataStart: number; dataEnd: number };
}

const WS = new Set([0, 9, 10, 12, 13, 32]);
const DELIM = new Set(['(', ')', '<', '>', '[', ']', '{', '}', '/', '%']);

const isWs = (c: number) => WS.has(c);
const isDelimCh = (ch: string) => DELIM.has(ch);
const isRegular = (src: string, i: number) => i < src.length && !isWs(src.charCodeAt(i)) && !isDelimCh(src[i]);
const NUM_RE = /^[+-]?(\d+\.?\d*|\.\d+)$/;

export class ContentParser {
  pos = 0;
  constructor(readonly src: string) {}

  private skipWsAndComments() {
    const s = this.src;
    for (;;) {
      while (this.pos < s.length && isWs(s.charCodeAt(this.pos))) this.pos++;
      if (s[this.pos] === '%') {
        while (this.pos < s.length && s[this.pos] !== '\n' && s[this.pos] !== '\r') this.pos++;
        continue;
      }
      break;
    }
  }

  private readLiteralString(): Operand {
    const s = this.src;
    const start = this.pos;
    let depth = 0;
    for (;;) {
      if (this.pos >= s.length) throw new Error(`unterminated string at ${start}`);
      const ch = s[this.pos];
      if (ch === '\\') { this.pos += 2; continue; } // escape (also covers \( \) and \<newline>)
      if (ch === '(') depth++;
      else if (ch === ')') { depth--; if (depth === 0) { this.pos++; break; } }
      this.pos++;
    }
    return { kind: 'string', start, end: this.pos };
  }

  private readName(): Operand {
    const s = this.src;
    const start = this.pos;
    this.pos++; // '/'
    let raw = '';
    while (isRegular(s, this.pos)) raw += s[this.pos++];
    const value = raw.replace(/#([0-9A-Fa-f]{2})/g, (_m, h) => String.fromCharCode(parseInt(h, 16)));
    return { kind: 'name', value, start, end: this.pos };
  }

  /** Parse one object (operand). Returns null when the next token is an operator keyword. */
  private readObject(): Operand | { op: string; start: number; end: number } {
    this.skipWsAndComments();
    const s = this.src;
    const start = this.pos;
    const ch = s[this.pos];
    if (ch === undefined) throw new Error('EOF');
    if (ch === '(') return this.readLiteralString();
    if (ch === '/') return this.readName();
    if (ch === '<') {
      if (s[this.pos + 1] === '<') {
        this.pos += 2;
        const entries = new Map<string, Operand>();
        for (;;) {
          this.skipWsAndComments();
          if (s[this.pos] === '>' && s[this.pos + 1] === '>') { this.pos += 2; break; }
          const k = this.readObject();
          if (!('kind' in k) || k.kind !== 'name') throw new Error(`dict key expected at ${this.pos}`);
          const v = this.readObject();
          if (!('kind' in v)) throw new Error(`dict value expected at ${this.pos}`);
          entries.set(k.value, v);
        }
        return { kind: 'dict', entries, start, end: this.pos };
      }
      const close = s.indexOf('>', this.pos);
      if (close < 0) throw new Error(`unterminated hex string at ${start}`);
      this.pos = close + 1;
      return { kind: 'string', start, end: this.pos };
    }
    if (ch === '[') {
      this.pos++;
      const items: Operand[] = [];
      for (;;) {
        this.skipWsAndComments();
        if (s[this.pos] === ']') { this.pos++; break; }
        const o = this.readObject();
        if (!('kind' in o)) throw new Error(`operator "${o.op}" inside array at ${o.start}`);
        items.push(o);
      }
      return { kind: 'array', items, start, end: this.pos };
    }
    if (ch === ']' || ch === '>' || ch === ')' || ch === '{' || ch === '}') {
      // stray delimiter: treat as a one-char operator so we never loop forever
      this.pos++;
      return { op: ch, start, end: this.pos };
    }
    // regular token: number, keyword/operator
    let tok = '';
    while (isRegular(s, this.pos)) tok += s[this.pos++];
    if (NUM_RE.test(tok)) return { kind: 'num', value: parseFloat(tok), start, end: this.pos };
    if (tok === 'true' || tok === 'false') return { kind: 'bool', start, end: this.pos };
    if (tok === 'null') return { kind: 'null', start, end: this.pos };
    return { op: tok, start, end: this.pos };
  }

  private readInlineImage(opStart: number): Op {
    const s = this.src;
    const dict = new Map<string, Operand>();
    for (;;) {
      const k = this.readObject();
      if ('op' in k) {
        if (k.op !== 'ID') throw new Error(`expected ID in inline image at ${k.start}, got ${k.op}`);
        break;
      }
      if (k.kind !== 'name') throw new Error(`inline image key expected at ${this.pos}`);
      const v = this.readObject();
      if (!('kind' in v)) throw new Error(`inline image value expected at ${this.pos}`);
      dict.set(k.value, v);
    }
    // exactly one whitespace byte follows ID (CRLF counts as one)
    if (s[this.pos] === '\r' && s[this.pos + 1] === '\n') this.pos += 2;
    else this.pos += 1;
    const dataStart = this.pos;
    let dataEnd = -1;
    const hasFilter = dict.has('F') || dict.has('Filter');
    const w = numVal(dict.get('W') ?? dict.get('Width'));
    const h = numVal(dict.get('H') ?? dict.get('Height'));
    if (!hasFilter && w && h) {
      const isMask = boolish(dict.get('IM') ?? dict.get('ImageMask'));
      const bpc = isMask ? 1 : numVal(dict.get('BPC') ?? dict.get('BitsPerComponent')) ?? 8;
      const csName = nameVal(dict.get('CS') ?? dict.get('ColorSpace'));
      const comps = isMask ? 1 : csName === 'G' || csName === 'DeviceGray' || csName === 'CalGray' ? 1 : csName === 'RGB' || csName === 'DeviceRGB' ? 3 : csName === 'CMYK' || csName === 'DeviceCMYK' ? 4 : undefined;
      if (comps) dataEnd = dataStart + Math.ceil((w * comps * bpc) / 8) * h;
    }
    if (dataEnd < 0 || !/^\s*EI(\s|$)/.test(s.slice(dataEnd, dataEnd + 6))) {
      // scan for whitespace + EI + (whitespace|EOF) that is followed by plausible content-stream text
      let i = dataStart;
      for (;;) {
        i = s.indexOf('EI', i);
        if (i < 0) throw new Error('inline image without EI');
        const before = i === dataStart ? 32 : s.charCodeAt(i - 1);
        const after = i + 2 >= s.length ? 32 : s.charCodeAt(i + 2);
        if ((isWs(before) || i === dataStart) && isWs(after)) {
          const tail = s.slice(i + 2, i + 2 + 24);
          if (/^[\x09\x0a\x0c\x0d\x20-\x7e]*$/.test(tail)) { dataEnd = i; break; }
        }
        i += 2;
      }
    }
    const eiPos = s.indexOf('EI', dataEnd);
    this.pos = eiPos + 2;
    return { operator: 'BI', operands: [], start: opStart, end: this.pos, inline: { dict, dataStart, dataEnd } };
  }

  /** Next operation (operands + operator), or null at EOF. */
  next(): Op | null {
    const operands: Operand[] = [];
    for (;;) {
      this.skipWsAndComments();
      if (this.pos >= this.src.length) return null;
      const start = operands.length ? operands[0].start : this.pos;
      const o = this.readObject();
      if ('kind' in o) { operands.push(o); continue; }
      if (o.op === 'BI') return this.readInlineImage(start);
      return { operator: o.op, operands, start, end: o.end };
    }
  }
}

function numVal(o?: Operand) { return o && o.kind === 'num' ? o.value : undefined; }
function nameVal(o?: Operand) { return o && o.kind === 'name' ? o.value : undefined; }
function boolish(o?: Operand) { return !!o && o.kind === 'bool'; }

export function parseContent(src: string): Op[] {
  const p = new ContentParser(src);
  const ops: Op[] = [];
  for (let op = p.next(); op; op = p.next()) ops.push(op);
  return ops;
}

export const nums = (o: Operand[]) => o.map((x) => (x.kind === 'num' ? x.value : NaN));
