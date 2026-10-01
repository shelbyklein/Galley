import fs from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  addFrame,
  addLayer,
  applyCommand,
  buildSentinelTable,
  createHistory,
  createStory,
  isSentinelCss,
  makeLayer,
  paint,
  parseDocument,
  setLayerProps,
  type GalleyDocument,
  type Id,
} from '@galley/model';
import { collectPaintedColors, createColorResolver, findNonSentinelColors, naiveCmykToRgb, PageView, type ColorMode } from '../src';

const dir = path.resolve(__dirname, '../../../fixtures/poster-basic.galley') + '/';
const poster = (): GalleyDocument =>
  parseDocument({ document: fs.readFileSync(dir + 'document.json', 'utf8'), links: fs.readFileSync(dir + 'links.json', 'utf8') });

const assetUrl = (asset: { path: string }) => `galley-asset://pkg/${asset.path}`;

function render(doc: GalleyDocument, mode: ColorMode, pageId: Id = doc.pageOrder[0]!): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = renderToStaticMarkup(<PageView doc={doc} pageId={pageId} colorMode={mode} assetUrl={assetUrl} />);
  return host;
}

describe('PageView: export mode paints only sentinels', () => {
  const doc = poster();
  const table = buildSentinelTable(doc);
  const host = render(doc, 'export');

  it('every painted color is one of the document\'s sentinel values (no soft-proof colors)', () => {
    const painted = collectPaintedColors(host);
    expect(painted.length).toBe(8); // 2 shape fills (orange block, ellipse) + 6 text colors: the scan really finds them
    expect(findNonSentinelColors(host, table)).toEqual([]);
  });

  it('uses each ink of the poster', () => {
    const used = new Set(collectPaintedColors(host).map((c) => c.value));
    expect(used.size).toBe(table.length);
    for (const entry of table) expect([...used].some((v) => isSentinelCss([entry], v))).toBe(true);
  });

  it('draws no paper, no editor chrome and no empty-frame mark', () => {
    expect(host.querySelector('.galley-paper')).toBeNull();
    expect(host.querySelector('[data-empty-image]')).toBeNull();
    expect(host.querySelector('.galley-page')!.getAttribute('data-color-mode')).toBe('export');
  });

  it('shows no screen-mode color anywhere, including the naive conversion of the orange swatch', () => {
    const [r, g, b] = naiveCmykToRgb({ values: [0, 60, 100, 0], tint: 100 });
    expect(host.innerHTML).not.toContain(`rgb(${r} ${g} ${b})`);
    expect(host.innerHTML).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it('fails loudly if the renderer is asked for a paint the sentinel table does not cover', () => {
    const resolver = createColorResolver(doc, 'export');
    expect(() => resolver.css(paint('teal'))).toThrow(/sentinel/); // Teal is defined but unused, so it has no sentinel
    expect(resolver.css(null)).toBe('none');
  });

  it('keeps document colors out of the stylesheet', () => {
    const css = fs.readFileSync(path.resolve(__dirname, '../src/page.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const colorish = /(^|[;{\s])(color|background(-color|-image)?|border(-[a-z]+)?-color|outline(-color)?|box-shadow|text-shadow|fill|stroke)\s*:\s*([^;}]+)/gi;
    const offenders = [...css.matchAll(colorish)].map((m) => m[0].trim()).filter((d) => !/:\s*(none|transparent|inherit)\s*$/i.test(d));
    expect(offenders).toEqual([]);
  });
});

describe('PageView: screen mode', () => {
  const doc = poster();
  const host = render(doc, 'screen');

  it('draws the paper on the trim box and uses soft-proof colors, none of them sentinels', () => {
    const paper = host.querySelector<HTMLElement>('.galley-paper')!;
    expect(paper).not.toBeNull();
    expect(paper.style.left).toBe('36pt'); // slug 36 pt beyond trim
    expect(paper.style.width).toBe('792pt');
    const table = buildSentinelTable(doc);
    const nonSentinel = findNonSentinelColors(host, table);
    expect(nonSentinel.length).toBeGreaterThan(8);
    expect(host.querySelector('rect[data-frame-id="orange-block"]')!.getAttribute('fill')).toBe('rgb(255 102 0)');
  });

  it('uses the injected soft proof when given', () => {
    const resolver = createColorResolver(doc, 'screen', { softProof: () => [1, 2, 3] });
    expect(resolver.css(paint('warm-orange'))).toBe('rgb(1 2 3)');
  });
});

describe('PageView: export clips to the bleed box', () => {
  const doc = poster();

  it('wraps the page in a clip-path of the sheet minus the bleed (slug 36 pt, bleed 9 pt: 27 pt each side)', () => {
    const clip = render(doc, 'export').querySelector<HTMLElement>('.galley-clip')!;
    expect(clip.style.clipPath).toBe('inset(27pt 27pt 27pt 27pt)');
    expect(clip.style.width).toBe('864pt');
    expect(clip.style.overflow).toBe('');
  });

  it('clips at the trim edge when the page has no bleed, and not at all in screen mode', () => {
    const noBleed = { ...doc, pages: { page_1: { ...doc.pages['page_1']!, bleed: { top: 0, right: 0, bottom: 0, left: 0 } } } };
    expect(render(noBleed, 'export').querySelector<HTMLElement>('.galley-clip')!.style.clipPath).toBe('inset(36pt 36pt 36pt 36pt)');
    expect(render(doc, 'screen').querySelector('.galley-clip')).toBeNull();
  });
});

describe('PageView: structure', () => {
  const doc = poster();

  it('sizes the sheet to trim plus the larger of bleed and slug', () => {
    const page = render(doc, 'screen').querySelector<HTMLElement>('.galley-page')!;
    expect(page.style.width).toBe('864pt');
    expect(page.style.height).toBe('1296pt');
    expect(page.getAttribute('lang')).toBe('en-US');
  });

  it('puts frames at page coordinates offset by the sheet origin, with the bleed block at negative coordinates', () => {
    const host = render(doc, 'screen');
    // slug 36 pt: page (0, 0) is sheet (36, 36); the block starts 9 pt before the trim
    const block = host.querySelector('rect[data-frame-id="orange-block"]')!;
    expect([block.getAttribute('x'), block.getAttribute('y'), block.getAttribute('width'), block.getAttribute('height')]).toEqual(['27', '27', '810', '474']);
    const spring = host.querySelector<HTMLElement>('[data-frame-id="spring"]')!;
    // frames sit at the sheet origin and are moved by a translate (P1-04: left/top would snap to 0.75 pt)
    expect(spring.style.transform).toBe('translate(72pt, 108pt)');
    expect(spring.style.left).toBe('0px');
    expect(spring.style.width).toBe('720pt');
    expect(spring.style.clipPath).toBe('inset(0)'); // not overflow: hidden, which would snap the box size to whole pixels
    expect(spring.style.overflow).toBe('');
    const ellipse = host.querySelector('ellipse[data-frame-id="free-ellipse"]')!;
    expect(ellipse.getAttribute('cx')).toBe('695'); // 36 + 579 + 80
    expect(ellipse.getAttribute('rx')).toBe('80');
  });

  it('renders story text with the story\'s default style', () => {
    const host = render(doc, 'screen');
    const spring = host.querySelector<HTMLElement>('[data-frame-id="spring"]')!;
    expect(spring.textContent).toBe('SPRING');
    expect(spring.style.fontFamily).toContain('Inter');
    expect(spring.style.fontWeight).toBe('800');
    expect(spring.style.fontSize).toBe('160pt');
    expect(spring.style.lineHeight).toBe('168pt');
    expect(spring.style.letterSpacing).toBe('-0.02em');
    expect(host.querySelector('[data-frame-id="free"]')!.getAttribute('style')).toContain('text-align:center');
    expect(host.querySelector('[data-frame-id="body"]')!.textContent).toMatch(/^Twenty studios open their doors/);
  });

  it('places the photo through the asset URL, clipped to its frame', () => {
    const host = render(doc, 'screen');
    const frame = host.querySelector<HTMLElement>('[data-frame-id="photo-frame"]')!;
    const img = frame.querySelector('img')!;
    expect(img.getAttribute('src')).toBe('galley-asset://pkg/assets/photo.jpg');
    // laid out at its natural pixel size, then scaled by a transform to the frame's content rectangle (720 x 384 pt)
    expect(img.style.width).toBe('2400px');
    expect(img.style.height).toBe('1280px');
    expect(img.style.transform).toBe('translate(0pt, 0pt) scale(0.4, 0.4)'); // 720 pt = 960 px = 2400 px x 0.4
    expect(frame.style.transform).toBe('translate(72pt, 552pt)');
    expect(frame.classList.contains('galley-image')).toBe(true);
  });

  it('rotates a text frame about its own center: translate to the frame, then rotate about the box center', () => {
    let h = createHistory(doc);
    h = applyCommand(h, addFrame, {
      frame: { id: 'tilted', type: 'text', name: '', layerId: 'layer_1', x: 100.25, y: 50.5, w: 90, h: 30, rotation: 12.5, fill: null, stroke: null, storyId: 'story_tilted', inset: 0 },
      pageId: doc.pageOrder[0]!,
      story: createStory('story_tilted', 'Tilted', {}),
    });
    const el = render(h.doc, 'screen').querySelector<HTMLElement>('[data-frame-id="tilted"]')!;
    expect(el.style.transform).toBe('translate(136.25pt, 86.5pt) rotate(12.5deg)');
  });

  it('paints in document order: shapes in SVG runs, text and images between them', () => {
    const host = render(doc, 'screen');
    const order = [...host.querySelectorAll('[data-frame-id]')].map((el) => el.getAttribute('data-frame-id'));
    expect(order).toEqual(['orange-block', 'spring', 'open-studio', 'details', 'body', 'url', 'free-ellipse', 'free', 'photo-frame']);
  });

  it('skips hidden layers, and draws layers bottom to top', () => {
    let h = createHistory(doc);
    h = applyCommand(h, addLayer, { layer: makeLayer({ id: 'layer_top', name: 'Top' }) });
    h = applyCommand(h, addFrame, {
      frame: { id: 'top-rect', type: 'rect', name: '', layerId: 'layer_top', x: 0, y: 0, w: 10, h: 10, rotation: 0, fill: paint('black'), stroke: null },
      pageId: doc.pageOrder[0]!,
      index: 0, // lowest in the page's list, but its layer is on top
    });
    const order = [...render(h.doc, 'screen').querySelectorAll('[data-frame-id]')].map((el) => el.getAttribute('data-frame-id'));
    expect(order[order.length - 1]).toBe('top-rect');
    h = applyCommand(h, setLayerProps, { id: 'layer_top', props: { visible: false } });
    expect(render(h.doc, 'screen').querySelector('[data-frame-id="top-rect"]')).toBeNull();
    h = applyCommand(h, setLayerProps, { id: 'layer_1', props: { visible: false } });
    expect(render(h.doc, 'screen').querySelectorAll('[data-frame-id]').length).toBe(0);
  });

  it('marks an empty graphic frame in screen mode only', () => {
    let h = createHistory(doc);
    h = applyCommand(h, addFrame, {
      frame: { id: 'empty', type: 'image', name: '', layerId: 'layer_1', x: 10, y: 10, w: 100, h: 80, rotation: 0, fill: null, stroke: null, assetId: null, content: null },
      pageId: doc.pageOrder[0]!,
    });
    expect(render(h.doc, 'screen').querySelector('[data-empty-image="empty"]')).not.toBeNull();
    expect(render(h.doc, 'export').querySelector('[data-empty-image="empty"]')).toBeNull();
  });

  it('renders rotated frames and strokes with exact SVG attributes', () => {
    let h = createHistory(doc);
    h = applyCommand(h, addFrame, {
      frame: { id: 'rot', type: 'rect', name: '', layerId: 'layer_1', x: 100, y: 100, w: 50, h: 20, rotation: 30, fill: null, stroke: { paint: paint('black', 100, true), weight: 0.25 } },
      pageId: doc.pageOrder[0]!,
    });
    const rect = render(h.doc, 'export').querySelector('rect[data-frame-id="rot"]')!;
    expect(rect.getAttribute('stroke-width')).toBe('0.25');
    expect(rect.getAttribute('transform')).toBe('rotate(30 161 146)');
    expect(rect.getAttribute('fill')).toBe('none');
    expect(isSentinelCss(buildSentinelTable(h.doc), rect.getAttribute('stroke')!)).toBe(true);
  });
});
