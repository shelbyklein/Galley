import test from 'node:test';
import assert from 'node:assert/strict';
import { parseContent } from './tokenizer.ts';

const ops = (s: string) => parseContent(s).map((o) => o.operator);

test('basic operators and numbers incl. leading-dot and negative', () => {
  const o = parseContent('.23999999 0 0 -.23999999 0 864 cm q .0392 .0392 .2157 rg 36 36 840 408 re f Q');
  assert.deepEqual(o.map((x) => x.operator), ['cm', 'q', 'rg', 're', 'f', 'Q']);
  assert.equal(o[0].operands.length, 6);
  assert.equal((o[2].operands[2] as any).value, 0.2157);
});

test('names adjacent to operators without whitespace', () => {
  assert.deepEqual(ops('/Pattern CS/Pattern cs/P8 SCN/P8 scn 1 2 3 4 re'), ['CS', 'cs', 'SCN', 'scn', 're']);
});

test('literal strings: nested parens, escapes, operator-looking text', () => {
  const s = '(a (nested) b \\) rg) Tj (x\\\\) Tj (EI q Q) Tj';
  assert.deepEqual(ops(s), ['Tj', 'Tj', 'Tj']);
});

test('hex strings and TJ arrays', () => {
  const o = parseContent('[<0054> -20 (a) 5 <00 57>] TJ <0023008200b7> Tj');
  assert.deepEqual(o.map((x) => x.operator), ['TJ', 'Tj']);
  assert.equal((o[0].operands[0] as any).items.length, 5);
});

test('dict operands (BDC property list) and names with #xx', () => {
  const o = parseContent('/Span << /MCID 3 /Lang (en) /K [1 2 <</A /B#20C>>] >> BDC 0 g EMC');
  assert.deepEqual(o.map((x) => x.operator), ['BDC', 'g', 'EMC']);
});

test('comments are skipped, including those containing operators', () => {
  assert.deepEqual(ops('1 0 0 rg % 0 0 0 rg q\n1 2 3 4 re f'), ['rg', 're', 'f']);
});

test('inline image: binary data containing EI and fake operators (unfiltered, length from dict)', () => {
  const data = 'xx EI q 1 0 0 rg Q EI yy'; // 24 bytes of "pixels"
  const s = `q BI /W 24 /H 1 /BPC 8 /CS /G ID ${data}\nEI Q 0 0 0 1 k`;
  const o = parseContent(s);
  assert.deepEqual(o.map((x) => x.operator), ['q', 'BI', 'Q', 'k']);
  assert.equal(s.slice(o[1].inline!.dataStart, o[1].inline!.dataEnd), data);
});

test('inline image: filtered data, EI found by scan with trailing-context check', () => {
  const data = '\x00\x01\x02 EI \xff\xfe\x80'; // the in-data " EI " is followed by binary junk, so it is rejected
  const s = `BI /W 4 /H 4 /BPC 8 /CS /G /F /Fl ID ${data}\nEI\nQ`;
  const o = parseContent(s);
  assert.deepEqual(o.map((x) => x.operator), ['BI', 'Q']);
});

test('inline image abbreviations with array filters', () => {
  const s = 'BI /W 2 /H 2 /BPC 8 /CS /RGB /F [/AHx /Fl] ID 00ff00 >\nEI 1 0 0 rg';
  assert.deepEqual(ops(s), ['BI', 'rg']);
});

test('quote operators and star variants', () => {
  assert.deepEqual(ops("(a) ' 1 2 (b) \" T* f* W* n B* b*"), ["'", '"', 'T*', 'f*', 'W*', 'n', 'B*', 'b*']);
});
