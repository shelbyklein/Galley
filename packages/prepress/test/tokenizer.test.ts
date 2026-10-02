import { describe, expect, it } from 'vitest';
import { parseContent } from '../src/tokenizer';

const ops = (s: string) => parseContent(s).map((o) => o.operator);

describe('content-stream tokenizer (ported from the press spike)', () => {
  it('reads operators and numbers, including leading-dot and negative', () => {
    const o = parseContent('.23999999 0 0 -.23999999 0 864 cm q .0392 .0392 .2157 rg 36 36 840 408 re f Q');
    expect(o.map((x) => x.operator)).toEqual(['cm', 'q', 'rg', 're', 'f', 'Q']);
    expect(o[0]!.operands.length).toBe(6);
    expect((o[2]!.operands[2] as { value: number }).value).toBe(0.2157);
  });

  it('reads names adjacent to operators without whitespace', () => {
    expect(ops('/Pattern CS/Pattern cs/P8 SCN/P8 scn 1 2 3 4 re')).toEqual(['CS', 'cs', 'SCN', 'scn', 're']);
  });

  it('reads literal strings: nested parens, escapes, operator-looking text', () => {
    expect(ops('(a (nested) b \\) rg) Tj (x\\\\) Tj (EI q Q) Tj')).toEqual(['Tj', 'Tj', 'Tj']);
  });

  it('reads hex strings and TJ arrays', () => {
    const o = parseContent('[<0054> -20 (a) 5 <00 57>] TJ <0023008200b7> Tj');
    expect(o.map((x) => x.operator)).toEqual(['TJ', 'Tj']);
    expect((o[0]!.operands[0] as { items: unknown[] }).items.length).toBe(5);
  });

  it('reads dict operands (BDC property list) and names with #xx', () => {
    const o = parseContent('/Span << /MCID 3 /Lang (en) /K [1 2 <</A /B#20C>>] >> BDC 0 g EMC');
    expect(o.map((x) => x.operator)).toEqual(['BDC', 'g', 'EMC']);
  });

  it('skips comments, including those containing operators', () => {
    expect(ops('1 0 0 rg % 0 0 0 rg q\n1 2 3 4 re f')).toEqual(['rg', 're', 'f']);
  });

  it('inline image: binary data containing EI and fake operators (unfiltered, length from dict)', () => {
    const data = 'xx EI q 1 0 0 rg Q EI yy'; // 24 bytes of "pixels"
    const s = `q BI /W 24 /H 1 /BPC 8 /CS /G ID ${data}\nEI Q 0 0 0 1 k`;
    const o = parseContent(s);
    expect(o.map((x) => x.operator)).toEqual(['q', 'BI', 'Q', 'k']);
    expect(s.slice(o[1]!.inline!.dataStart, o[1]!.inline!.dataEnd)).toBe(data);
  });

  it('inline image: filtered data, EI found by scan with a trailing-context check', () => {
    const data = '\x00\x01\x02 EI \xff\xfe\x80'; // the in-data " EI " is followed by binary junk, so it is rejected
    const s = `BI /W 4 /H 4 /BPC 8 /CS /G /F /Fl ID ${data}\nEI\nQ`;
    expect(ops(s)).toEqual(['BI', 'Q']);
  });

  it('inline image abbreviations with array filters', () => {
    expect(ops('BI /W 2 /H 2 /BPC 8 /CS /RGB /F [/AHx /Fl] ID 00ff00 >\nEI 1 0 0 rg')).toEqual(['BI', 'rg']);
  });

  it('reads quote operators and star variants', () => {
    expect(ops("(a) ' 1 2 (b) \" T* f* W* n B* b*")).toEqual(["'", '"', 'T*', 'f*', 'W*', 'n', 'B*', 'b*']);
  });
});
