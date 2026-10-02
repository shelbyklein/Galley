import { BASIC_PARAGRAPH_PROPS } from '@galley/model';
import { describe, expect, it } from 'vitest';
import { dropCapCss, splitDropCapRuns } from './dropcaps';
describe('multi-character initials', () => {
  it('preserves marked text and Unicode across the split without adding or dropping a character', () => {
    const runs = [{ type: 'text', text: '🙂A', marks: [{ type: 'charStyle', attrs: { style: 'em' } }] }, { type: 'text', text: 'BC def' }];
    const { initial, rest } = splitDropCapRuns(runs, 3);
    expect(initial.map((r) => r.text).join('')).toBe('🙂AB');
    expect(rest.map((r) => r.text).join('')).toBe('C def');
    expect(initial[0]!.marks).toEqual(runs[0]!.marks);
    expect([...initial, ...rest].map((r) => r.text).join('')).toBe('🙂ABC def');
    expect(runs[1]!.text).toBe('BC def');
  });
  it('reserves exactly the requested number of leadings, and leaves native single-letter initials alone', () => {
    expect(dropCapCss({ ...BASIC_PARAGRAPH_PROPS, fontSize: 12, leading: 15, dropCapLines: 3, dropCapChars: 2 })).toMatchObject({ float: 'left', fontSize: '42pt', lineHeight: '45pt', height: '45pt' });
    expect(dropCapCss({ ...BASIC_PARAGRAPH_PROPS, dropCapLines: 3 })).toEqual({});
  });
});
