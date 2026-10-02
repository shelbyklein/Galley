// Shared helpers for the prepress unit tests: a small document with every kind of ink, and a hand-made "Chromium" PDF.
import { PDFDocument, PDFName } from '@cantoo/pdf-lib';
import {
  addFrame,
  addSwatch,
  applyCommand,
  buildSentinelTable,
  createDocument,
  createHistory,
  paint,
  SWATCH_BLACK,
  SWATCH_PAPER,
  type GalleyDocument,
  type SentinelEntry,
} from '@galley/model';

/** A document using 100K black, a CMYK swatch, a spot color, a tint of it and overprinting black. */
export function inkDoc(page: { width?: number; height?: number; bleed?: number; slug?: number } = {}): GalleyDocument {
  let h = createHistory(
    createDocument({
      title: 'Prepress test',
      engineVersion: '44.5.1',
      page: { id: 'page_1', width: page.width ?? 200, height: page.height ?? 100, bleed: page.bleed ?? 9, slug: page.slug ?? 36, margins: 10 },
      layer: { id: 'layer_1' },
    }),
  );
  h = applyCommand(h, addSwatch, { swatch: { id: 'orange', name: 'Orange', type: 'cmyk', values: [0, 60, 100, 0] } });
  h = applyCommand(h, addSwatch, { swatch: { id: 'pms', name: 'PANTONE 185 C', type: 'spot', values: [0, 91, 76, 0] } });
  const rect = (id: string, fill: ReturnType<typeof paint> | null, stroke: ReturnType<typeof paint> | null = null) => ({
    id,
    type: 'rect' as const,
    name: '',
    layerId: 'layer_1',
    x: 0,
    y: 0,
    w: 10,
    h: 10,
    rotation: 0,
    fill,
    stroke: stroke ? { paint: stroke, weight: 1 } : null,
  });
  h = applyCommand(h, addFrame, { frame: rect('a', paint('orange')), pageId: 'page_1' });
  h = applyCommand(h, addFrame, { frame: rect('b', paint('pms', 40), paint(SWATCH_BLACK, 100, true)), pageId: 'page_1' });
  h = applyCommand(h, addFrame, { frame: rect('c', paint(SWATCH_BLACK), paint(SWATCH_PAPER)), pageId: 'page_1' });
  return h.doc;
}

/** The `rg`/`RG` operands Skia prints for a sentinel: 0..1, four decimals. */
export function sentinelOperands(e: SentinelEntry): string {
  return e.rgb.map((v) => (v / 255).toFixed(4).replace(/0+$/, '').replace(/^0\./, '.')).join(' ');
}

export function entryByKey(table: readonly SentinelEntry[], key: string): SentinelEntry {
  const e = table.find((t) => t.key === key);
  if (!e) throw new Error(`no sentinel ${key} in ${table.map((t) => t.key).join(', ')}`);
  return e;
}

export function tableOf(doc: GalleyDocument): SentinelEntry[] {
  return buildSentinelTable(doc);
}

/** A one-page PDF with the given content stream and page size, like Chromium's output (RGB, no boxes beyond MediaBox). */
export async function chromiumLikePdf(content: string, width: number, height: number): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([width, height]);
  const ctx = pdf.context;
  page.node.set(PDFName.of('Resources'), ctx.obj({}));
  page.node.set(PDFName.of('Contents'), ctx.register(ctx.flateStream(Buffer.from(content, 'latin1'))));
  return pdf.save({ useObjectStreams: false });
}
