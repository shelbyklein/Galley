// @vitest-environment jsdom
import fs from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { bolderWeight, buildSentinelTable, paragraphAttrs, parseDocument, resolveParagraph, resolveRun, type GalleyDocument } from '@galley/model';
import { createColorResolver, findNonSentinelColors, num, PageView, paragraphCss, pt, runCss, usedFontFaces } from '../src';

/**
 * P2-01: a migrated v1 document produces the same CSS as the Phase 1 renderer did. The Phase 1 renderer put these declarations
 * on the frame box (below, copied from its TextFrameView) and `strong` / `em` elements inside; v2 puts them on each <p> and
 * <span>. The pixels are compared by e2e/text/migration.e2e.ts against baselines captured from the Phase 1 build.
 */
const V1_DIR = path.resolve(__dirname, '../../../fixtures/v1');
const NAMES = fs.readdirSync(V1_DIR).filter((n) => n.endsWith('.galley')).sort();
const files = (name: string) => ({ document: fs.readFileSync(`${V1_DIR}/${name}/document.json`, 'utf8'), links: fs.readFileSync(`${V1_DIR}/${name}/links.json`, 'utf8') });
const assetUrl = (a: { path: string }) => `galley-asset://pkg/${a.path}`;

/** The style the Phase 1 TextFrameView put on the frame box for a story's defaults. */
function v1FrameStyle(d: Record<string, any>, colors: ReturnType<typeof createColorResolver>) {
  const style: Record<string, unknown> = {
    fontFamily: `"${d.fontFamily}", sans-serif`,
    fontWeight: d.fontWeight,
    fontStyle: d.fontStyle,
    fontSize: pt(d.fontSize),
    lineHeight: pt(d.leading),
    letterSpacing: d.tracking !== 0 ? `${num(d.tracking / 1000)}em` : undefined,
    textAlign: d.align,
    color: colors.css(d.fill),
  };
  return Object.fromEntries(Object.entries(style).filter(([, v]) => v !== undefined));
}

describe.each(NAMES)('v1 fixture %s, migrated', (name) => {
  const raw = JSON.parse(files(name).document);
  const doc: GalleyDocument = parseDocument(files(name));

  for (const mode of ['screen', 'export'] as const) {
    it(`gives every paragraph the CSS the v1 frame box had, and every run what strong and em meant (${mode} colors)`, () => {
      const colors = createColorResolver(doc, mode);
      for (const [id, story] of Object.entries<any>(raw.stories)) {
        const expectedParagraph = v1FrameStyle(story.defaults, colors);
        story.doc.content.forEach((v1p: any, i: number) => {
          const p = doc.stories[id]!.doc.content![i]!;
          const paragraph = resolveParagraph(doc, paragraphAttrs(p));
          // textAlign etc. are all present; nothing else is emitted for a v1 paragraph
          expect(paragraphCss(paragraph, colors, { dropSpaceBefore: i === 0 }), `${id} paragraph ${i}`).toEqual(expectedParagraph);
          // each v1 run, in order: strong was `font-weight: bolder` of the default, em was italic
          const expectedRuns = (v1p.content ?? []).map((t: any) => {
            const types = (t.marks ?? []).map((m: any) => m.type);
            const css: Record<string, unknown> = {};
            if (types.includes('strong') && bolderWeight(story.defaults.fontWeight) !== story.defaults.fontWeight) css.fontWeight = bolderWeight(story.defaults.fontWeight);
            if (types.includes('em') && story.defaults.fontStyle !== 'italic') css.fontStyle = 'italic';
            return [t.text, css];
          });
          // (the migration merges neighbours that ended up with the same marks)
          const merged: [string, Record<string, unknown>][] = [];
          for (const [text, css] of expectedRuns as [string, Record<string, unknown>][]) {
            const last = merged[merged.length - 1];
            if (last && JSON.stringify(last[1]) === JSON.stringify(css)) last[0] += text;
            else merged.push([text, css]);
          }
          const actual = (p.content ?? []).map((t) => [t.text, runCss(paragraph, resolveRun(doc, paragraph, t.marks), colors)]);
          expect(actual, `${id} paragraph ${i} runs`).toEqual(merged);
        });
      }
    });

    it(`renders the page in ${mode} mode, and in export mode paints only sentinels`, () => {
      const host = document.createElement('div');
      host.innerHTML = renderToStaticMarkup(<PageView doc={doc} pageId={doc.pageOrder[0]!} colorMode={mode} assetUrl={assetUrl} />);
      expect(host.querySelectorAll('.galley-text').length).toBe(Object.keys(raw.stories).length);
      if (mode === 'export') expect(findNonSentinelColors(host, buildSentinelTable(doc))).toEqual([]);
    });
  }

  it('loads the same font faces the v1 page needed: the defaults, plus bolder for strong and italic for em', () => {
    const expected = new Set<string>();
    for (const frame of Object.values<any>(raw.frames)) {
      if (frame.type !== 'text') continue;
      const story = raw.stories[frame.storyId];
      const d = story.defaults;
      const marks = new Set<string>();
      for (const p of story.doc.content) for (const t of p.content ?? []) for (const m of t.marks ?? []) marks.add(m.type);
      const weights = new Set<number>([d.fontWeight]);
      if (marks.has('strong')) weights.add(bolderWeight(d.fontWeight));
      const styles = new Set<string>([d.fontStyle]);
      if (marks.has('em')) styles.add('italic');
      for (const w of weights) for (const s of styles) expected.add(`${s} ${w} 16px "${d.fontFamily}"`);
    }
    // v2 only lists faces a run actually uses (v1 listed the product of weights and styles), so it is a subset that still covers every run
    const faces = new Set(usedFontFaces(doc, doc.pageOrder[0]!));
    for (const f of faces) expect(expected.has(f), f).toBe(true);
    for (const frame of Object.values<any>(raw.frames)) {
      if (frame.type !== 'text') continue;
      const d = raw.stories[frame.storyId].defaults;
      expect(faces.has(`${d.fontStyle} ${d.fontWeight} 16px "${d.fontFamily}"`) || raw.stories[frame.storyId].doc.content.every((p: any) => !p.content), frame.id).toBe(true);
    }
  });
});
