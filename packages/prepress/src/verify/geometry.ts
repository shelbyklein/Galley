// Measure where things are in a PDF: a small content-stream interpreter that tracks the current transformation matrix
// through q / Q / cm and records the bounding boxes of painted paths, clips and images and the origin of every text run,
// all in points from the TOP-LEFT of the MediaBox (the CSS orientation the renderer lays out in).
//
// It reads what Chromium/Skia emit (and what the prepress step writes): `re m l c h`, `f f* S B`, `W n`, `Do`, `BT Tm Td Tj TJ`,
// forms via `Do`. It is a measurement tool for tests, not a general PDF renderer.
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream } from '@cantoo/pdf-lib';
import { nums, parseContent } from '../tokenizer.ts';
import { N, bytesToLatin1, dictGet, nameOf, streamBytes } from '../pdfio.ts';

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface PaintedPath {
  box: Box;
  kind: 'fill' | 'stroke' | 'fill+stroke';
  /** Stroke width in points (0 when only filled). */
  lineWidth: number;
}

export interface TextRun {
  /** The glyph origin on the baseline of the run's first glyph: x from the left, y of the BASELINE from the top, in points. */
  x: number;
  y: number;
  /** Font size in points (Tf size times the matrices). */
  size: number;
  font: string;
}

export interface PdfGeometry {
  /** The MediaBox in PDF user units: [x0, y0, x1, y1]. */
  mediaBox: [number, number, number, number];
  paths: PaintedPath[];
  clips: Box[];
  texts: TextRun[];
  images: Box[];
}

type M = [number, number, number, number, number, number];
const IDENTITY: M = [1, 0, 0, 1, 0, 0];
/** `a` applied first, then `b` (PDF row-vector convention: p' = p a b). */
const mul = (a: M, b: M): M => [
  a[0] * b[0] + a[1] * b[2],
  a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2],
  a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4],
  a[4] * b[1] + a[5] * b[3] + b[5],
];
const apply = (m: M, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const scaleOf = (m: M) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));

export async function measurePdfGeometry(pdf: Uint8Array): Promise<PdfGeometry> {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  const ctx = doc.context;
  const page = doc.getPage(0);
  const mb = page.getMediaBox();
  const top = mb.y + mb.height;
  const left = mb.x;
  const out: PdfGeometry = { mediaBox: [mb.x, mb.y, mb.x + mb.width, mb.y + mb.height], paths: [], clips: [], texts: [], images: [] };

  const toTop = ([x, y]: [number, number]): [number, number] => [x - left, top - y];
  const boxOf = (pts: [number, number][]): Box => {
    const t = pts.map(toTop);
    return { x0: Math.min(...t.map((p) => p[0])), y0: Math.min(...t.map((p) => p[1])), x1: Math.max(...t.map((p) => p[0])), y1: Math.max(...t.map((p) => p[1])) };
  };

  const interpret = (src: string, start: M, resources: PDFDict | undefined, depth: number) => {
    let ctm = start;
    const stack: { ctm: M; lw: number; fontSize: number; font: string }[] = [];
    let lineWidth = 1;
    let fontSize = 1;
    let font = '';
    let tm: M = IDENTITY;
    let tlm: M = IDENTITY;
    let path: [number, number][] = [];
    let pendingClip = false;

    const paintPath = (kind: PaintedPath['kind']) => {
      if (path.length > 0) out.paths.push({ box: boxOf(path), kind, lineWidth: kind === 'fill' ? 0 : lineWidth * scaleOf(ctm) });
      endPath();
    };
    const endPath = () => {
      if (pendingClip && path.length > 0) out.clips.push(boxOf(path));
      pendingClip = false;
      path = [];
    };
    const addPoint = (x: number, y: number) => path.push(apply(ctm, x, y));
    const show = () => {
      const m = mul(tm, ctm);
      const [x, y] = toTop([m[4], m[5]]);
      out.texts.push({ x, y, size: fontSize * scaleOf(m), font });
    };

    for (const op of parseContent(src)) {
      const n = nums(op.operands);
      switch (op.operator) {
        case 'q':
          stack.push({ ctm, lw: lineWidth, fontSize, font });
          break;
        case 'Q': {
          const s = stack.pop();
          if (s) {
            ctm = s.ctm;
            lineWidth = s.lw;
            fontSize = s.fontSize;
            font = s.font;
          }
          break;
        }
        case 'cm':
          ctm = mul(n as unknown as M, ctm);
          break;
        case 'w':
          lineWidth = n[0]!;
          break;
        case 'm':
          addPoint(n[0]!, n[1]!);
          break;
        case 'l':
          addPoint(n[0]!, n[1]!);
          break;
        case 'c':
          addPoint(n[0]!, n[1]!);
          addPoint(n[2]!, n[3]!);
          addPoint(n[4]!, n[5]!);
          break;
        case 'v':
        case 'y':
          addPoint(n[0]!, n[1]!);
          addPoint(n[2]!, n[3]!);
          break;
        case 're':
          addPoint(n[0]!, n[1]!);
          addPoint(n[0]! + n[2]!, n[1]! + n[3]!);
          break;
        case 'W':
        case 'W*':
          pendingClip = true;
          break;
        case 'n':
          endPath();
          break;
        case 'f':
        case 'F':
        case 'f*':
          paintPath('fill');
          break;
        case 'S':
        case 's':
          paintPath('stroke');
          break;
        case 'B':
        case 'B*':
        case 'b':
        case 'b*':
          paintPath('fill+stroke');
          break;
        case 'BT':
          tm = IDENTITY;
          tlm = IDENTITY;
          break;
        case 'Tf':
          font = op.operands[0]?.kind === 'name' ? op.operands[0].value : '';
          fontSize = n[1]!;
          break;
        case 'Tm':
          tm = n as unknown as M;
          tlm = tm;
          break;
        case 'Td':
        case 'TD':
          tlm = mul([1, 0, 0, 1, n[0]!, n[1]!], tlm);
          tm = tlm;
          break;
        case 'Tj':
        case 'TJ':
        case "'":
        case '"':
          show();
          break;
        case 'Do': {
          const name = op.operands[0]?.kind === 'name' ? op.operands[0].value : '';
          const xobjects = dictGet(ctx, resources, 'XObject', PDFDict);
          const xo = xobjects ? ctx.lookup(xobjects.get(N(name))) : undefined;
          if (!(xo instanceof PDFRawStream)) break;
          const subtype = nameOf(xo.dict.get(N('Subtype')));
          if (subtype === 'Image') {
            out.images.push(boxOf([apply(ctm, 0, 0), apply(ctm, 1, 0), apply(ctm, 0, 1), apply(ctm, 1, 1)]));
          } else if (subtype === 'Form' && depth < 8) {
            const matrix = ctx.lookupMaybe(xo.dict.get(N('Matrix')), PDFArray);
            const fm = matrix ? (matrix.asArray().map((v) => (ctx.lookup(v, PDFNumber) as PDFNumber).asNumber()) as M) : IDENTITY;
            interpret(bytesToLatin1(streamBytes(xo)), mul(fm, ctm), dictGet(ctx, xo.dict, 'Resources', PDFDict) ?? resources, depth + 1);
          }
          break;
        }
        default:
          break;
      }
    }
  };

  const contents = page.node.lookup(PDFName.of('Contents'));
  const streams: PDFRawStream[] = contents instanceof PDFArray ? contents.asArray().map((r) => ctx.lookup(r) as PDFRawStream) : [contents as PDFRawStream];
  interpret(streams.map((s) => bytesToLatin1(streamBytes(s))).join('\n'), IDENTITY, page.node.Resources() as PDFDict | undefined, 0);
  return out;
}

