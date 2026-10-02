import { BASIC_PARAGRAPH_PROPS, createDocument, paint, type ResolvedParagraph } from '@galley/model';
import { describe, expect, it } from 'vitest';
import { createColorResolver } from '../color';
import { paragraphCss, paragraphLanguage, runCss, toCssText } from './resolve';
const colors = createColorResolver(createDocument({ engineVersion: 'test' }), 'screen');
const full: ResolvedParagraph = { ...BASIC_PARAGRAPH_PROPS, fontFamily: 'Inter', fontWeight: 700, fontStyle: 'italic', fontSize: 13.5, leading: 17.25, tracking: -25, kerning: 'none', textCase: 'smallCaps', features: { ss20: true, ss01: false, frac: true, onum: true, smcp: true, liga: false }, language: 'de', role: 'body', firstLineIndent: -5, leftIndent: 12, rightIndent: 9, spaceBefore: 4.5, spaceAfter: 6.25, align: 'justify', hyphenate: false, hyphenMinWord: 8, hyphenMinBefore: 3, hyphenMinAfter: 4, hyphenLadder: 2, dropCapLines: 3, dropCapChars: 1, alignToBaselineGrid: true, web: { fontSize: '99rem', lineHeight: '4', tag: 'h1' } };
describe('complete print stylesheet', () => {
  it('snapshots every shared/print declaration independently of the stored web settings', () => {
    expect(toCssText(paragraphCss(full, colors))).toMatchInlineSnapshot(`"font-family: "Inter", sans-serif; font-weight: 700; font-style: italic; font-size: 13.5pt; line-height: 17.25pt; letter-spacing: -0.025em; color: rgb(0 0 0); font-variant-caps: small-caps; font-kerning: none; font-feature-settings: "frac" 1, "liga" 0, "onum" 1, "smcp" 1, "ss01" 0, "ss20" 1; text-align: justify; hyphens: manual; hyphenate-limit-chars: 8 3 4; text-indent: -5pt; padding-left: 12pt; padding-right: 9pt; padding-top: 4.5pt; padding-bottom: 6.25pt; hyphenate-limit-lines: 2; --galley-drop-lines: 3"`);
    expect(paragraphLanguage(full)).toBe('de');
    // Semantic role and grid alignment are model/layout metadata, not font CSS. Web settings cannot alter print.
    expect(paragraphCss(full, colors)).toEqual(paragraphCss({ ...full, web: {}, role: null, alignToBaselineGrid: false }, colors));
    expect(toCssText(paragraphCss(full, colors))).not.toContain('99rem');
  });
  it('renders super/subscript baseline offsets, resets inherited case/kerning/tracking and preserves feature switches', () => {
    const base = { ...full, textCase: 'allCaps' as const };
    const run = { ...base, fontSize: 9, leading: 10, baselineShift: -3, tracking: 0, kerning: 'metrics' as const, textCase: 'normal' as const, features: { liga: true, frac: false }, fill: paint('paper') };
    expect(toCssText(runCss(base, run, colors))).toMatchInlineSnapshot(`"font-size: 9pt; line-height: 10pt; letter-spacing: normal; color: rgb(255 255 255); font-feature-settings: "frac" 0, "liga" 1; text-transform: none; font-kerning: normal; position: relative; top: 3pt"`);
    expect(runCss(base, { ...base, baselineShift: 4 }, colors).top).toBe('-4pt');
  });
  it('leaves neutral values absent, drops space before a frame start, and escapes font-family names', () => {
    expect(paragraphCss(BASIC_PARAGRAPH_PROPS, colors)).not.toHaveProperty('--galley-drop-lines');
    expect(paragraphCss(full, colors, { dropSpaceBefore: true })).not.toHaveProperty('paddingTop');
    expect(paragraphCss({ ...full, fontFamily: 'Family "Quoted"' }, colors).fontFamily).toBe('"Family \\"Quoted\\"", sans-serif');
  });
});
