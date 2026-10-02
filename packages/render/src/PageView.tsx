import {
  isLayerVisible,
  paintOrder,
  paragraphAttrs,
  resolveParagraph,
  type Asset,
  type BoxFrame,
  type EllipseFrame,
  type GalleyDocument,
  type Id,
  type ImageFrame,
  type LineFrame,
  type Page,
  type RectFrame,
  type Story,
  type StyleTables,
  type TextFrame,
} from '@galley/model';
import { memo, useEffect, useMemo, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import { createColorResolver, type ColorMode, type ColorResolver, type SoftProofFn } from './color';
import { getFontEpoch, subscribeFonts } from './fontRuntime';
import { loadPageResources, usedFontFaces, usedImageUrls } from './fontLoading';
import { bleedClipInsets, htmlFrameStyle, num, pt, sheetGeometry } from './geometry';
import { defaultSoftProof, getSoftProofEpoch, getSoftProofSource, subscribeSoftProof } from './softproof';
import { paragraphCss, paragraphLanguage } from './styles/resolve';
import { StyledRuns } from './styles/StyledRuns';
import './page.css';
import './styles/dropcaps.css';

export type AssetUrlFn = (asset: Asset) => string;

export interface PageViewProps {
  doc: GalleyDocument;
  pageId: Id;
  /** `screen` for the editor, `export` for the hidden export window. */
  colorMode: ColorMode;
  /** URL the renderer loads an image asset from (the app serves package files through a custom protocol). */
  assetUrl: AssetUrlFn;
  /** Replace the colour source entirely. Lane A passes a soft-proofing resolver; most callers pass `softProof` or nothing. */
  resolver?: ColorResolver;
  /**
   * Screen mode only: ICC soft proof for inks. Without it, the application's default soft-proof source is used (see
   * ./softproof.ts), and without that, the temporary naive CMYK to RGB conversion.
   */
  softProof?: SoftProofFn;
  className?: string;
  style?: CSSProperties;
}

type Origin = { x: number; y: number };
type ShapeFrame = RectFrame | EllipseFrame | LineFrame;

const hasFill = (f: BoxFrame) => f.type !== 'line' && f.fill !== null;
const hasStroke = (f: BoxFrame) => f.stroke !== null && f.stroke.weight > 0;

// ------------------------------------------------------------------------------------------------------------ shapes

interface ShapeProps {
  frame: BoxFrame;
  /** Which geometry to draw. Text and image frames draw a rectangle for their fill and stroke. */
  shape: 'rect' | 'ellipse' | 'line';
  parts: 'both' | 'fill' | 'stroke';
  origin: Origin;
  colors: ColorResolver;
}

/** One frame's SVG geometry. SVG coordinates are in points (the <svg> has a pt viewBox), so edges are exact. */
const ShapeSvg = memo(function ShapeSvg({ frame, shape, parts, origin, colors }: ShapeProps) {
  const x = origin.x + frame.x;
  const y = origin.y + frame.y;
  const cx = x + frame.w / 2;
  const cy = y + frame.h / 2;
  const drawFill = parts !== 'stroke' && shape !== 'line';
  const weight = frame.stroke?.weight ?? 0;
  const drawStroke = parts !== 'fill' && frame.stroke !== null && weight > 0;
  if (!(drawFill && frame.fill) && !drawStroke) return null;
  const common = {
    fill: drawFill ? colors.css(frame.fill) : 'none',
    stroke: drawStroke ? colors.css(frame.stroke!.paint) : 'none',
    strokeWidth: drawStroke ? num(weight) : undefined,
    transform: frame.rotation !== 0 ? `rotate(${num(frame.rotation)} ${num(cx)} ${num(cy)})` : undefined,
    'data-frame-id': frame.id,
  };
  if (shape === 'ellipse') return <ellipse cx={num(cx)} cy={num(cy)} rx={num(frame.w / 2)} ry={num(frame.h / 2)} {...common} />;
  if (shape === 'line') return <line x1={num(x)} y1={num(cy)} x2={num(x + frame.w)} y2={num(cy)} {...common} />;
  return <rect x={num(x)} y={num(y)} width={num(frame.w)} height={num(frame.h)} {...common} />;
});

/** Editor only: the cross that marks an empty graphic frame. Never rendered in export mode. */
function EmptyImageMark({ frame, origin }: { frame: ImageFrame; origin: Origin }) {
  const x = origin.x + frame.x;
  const y = origin.y + frame.y;
  const cx = x + frame.w / 2;
  const cy = y + frame.h / 2;
  return (
    <path
      d={`M${num(x)} ${num(y)}L${num(x + frame.w)} ${num(y + frame.h)}M${num(x + frame.w)} ${num(y)}L${num(x)} ${num(y + frame.h)}`}
      fill="none"
      stroke="#8a8a8e"
      strokeWidth={0.75}
      transform={frame.rotation !== 0 ? `rotate(${num(frame.rotation)} ${num(cx)} ${num(cy)})` : undefined}
      data-empty-image={frame.id}
    />
  );
}

// ------------------------------------------------------------------------------------------------------------- text

interface TextProps {
  frame: TextFrame;
  story: Story;
  paragraphStyles: StyleTables['paragraphStyles'];
  characterStyles: StyleTables['characterStyles'];
  origin: Origin;
  colors: ColorResolver;
}

/**
 * A text frame: the story laid out by the browser inside the frame box, clipped to it (the clip is the frame, not the inset).
 * Each paragraph is a `<p>` carrying its resolved style as inline CSS (./styles/resolve.ts) and each run a `<span>` with only
 * what differs from its paragraph. Until the thread engine (P2-02) lays a story out across its frames, the first frame of a
 * thread shows the whole story and the other frames are empty.
 */
const TextFrameView = memo(function TextFrameView({ frame, story, paragraphStyles, characterStyles, origin, colors }: TextProps) {
  const tables = { paragraphStyles, characterStyles };
  const shown = story.frameIds[0] === frame.id;
  const paragraphs = shown
    ? (story.doc.content ?? []).map((p, i) => {
        const attrs = paragraphAttrs(p);
        const resolved = resolveParagraph(tables, attrs);
        return (
          <p key={`${i}:${resolved.dropCapLines}:${resolved.dropCapChars}`} lang={paragraphLanguage(resolved)} style={paragraphCss(resolved, colors, { dropSpaceBefore: i === 0 })} data-paragraph-style={attrs.style}>
            <StyledRuns runs={p.content ?? []} paragraph={resolved} tables={tables} colors={colors} />
          </p>
        );
      })
    : null;
  return (
    <div className="galley-text" style={htmlFrameStyle(frame, origin)} data-frame-id={frame.id} data-frame-type="text" data-story-id={story.id}>
      {frame.inset > 0 ? (
        // The inset is a translate, not padding: a padding of 3.6 pt is 4.8 px, and Chromium puts the first baseline on a whole
        // pixel, so it would land up to 0.375 pt off. A translate is exact (GEOMETRY.md).
        <div className="galley-text-inset" style={{ width: pt(Math.max(0, frame.w - 2 * frame.inset)), transform: `translate(${pt(frame.inset)}, ${pt(frame.inset)})` }}>
          {paragraphs}
        </div>
      ) : (
        paragraphs
      )}
    </div>
  );
});

// ------------------------------------------------------------------------------------------------------------ image

/**
 * An image frame: the frame box (placed and clipped by htmlFrameStyle) holds the image, laid out at its natural pixel size
 * and then moved and scaled to `frame.content` by a transform. A layout size in whole pixels never snaps, and a transform is
 * written to the PDF as an exact matrix, so the picture lands where the model says to within 0.01 pt, at any fractional
 * position or size (left/top/width/height in pt would snap the image to 0.75 pt steps).
 */
const ImageFrameView = memo(function ImageFrameView({ frame, asset, origin, assetUrl }: { frame: ImageFrame; asset: Asset; origin: Origin; assetUrl: AssetUrlFn }) {
  const c = frame.content!;
  const sx = c.w / (asset.width * 0.75); // natural pixels are CSS px, 0.75 pt each
  const sy = c.h / (asset.height * 0.75);
  return (
    <div className="galley-image" style={htmlFrameStyle(frame, origin)} data-frame-id={frame.id} data-frame-type="image">
      <img
        src={assetUrl(asset)}
        alt=""
        draggable={false}
        style={{ left: 0, top: 0, width: `${asset.width}px`, height: `${asset.height}px`, transform: `translate(${pt(c.x)}, ${pt(c.y)}) scale(${Math.round(sx * 1e8) / 1e8}, ${Math.round(sy * 1e8) / 1e8})` }}
      />
    </div>
  );
});

// -------------------------------------------------------------------------------------------------------------- page

/**
 * The shared page renderer: draws one page of a document to a DOM subtree, 1 pt = 1 CSS pt (scale it with a CSS
 * transform; never by changing sizes). Both the editor canvas and the hidden export page render with this component;
 * the only difference is `colorMode`.
 *
 * Structure, bottom to top, following the document's paint order (layers bottom first, then stacking order):
 *   - screen mode: the paper, white, on the trim box only (bleed and slug show the pasteboard)
 *   - shapes (and frame fills and strokes) in sheet-sized SVG layers
 *   - text and image frames as HTML boxes between those layers, so interleaving is exact
 * Editor chrome (selection, guides, handles) is not drawn here; it lives in an overlay (lane B) so exports never see it.
 * Hidden layers are not rendered. `data-ready="true"` appears once the fonts and images the page uses have loaded.
 */
export function PageView({ doc, pageId, colorMode, assetUrl, resolver, softProof, className, style }: PageViewProps) {
  const page = doc.pages[pageId];
  if (!page) throw new Error(`PageView: no page "${pageId}"`);
  const geo = sheetGeometry(page);

  // The default soft-proof source answers asynchronously: the epoch changes when answers arrive, which repaints the page.
  const proofEpoch = useSyncExternalStore(subscribeSoftProof, getSoftProofEpoch, getSoftProofEpoch);
  const proof = softProof ?? defaultSoftProof;

  // In screen mode a color depends only on the swatches, so dragging frames keeps the resolver (and the memoized frames) stable.
  const colors = useMemo(
    () => resolver ?? createColorResolver(doc, colorMode, { softProof: proof }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resolver, colorMode === 'export' ? doc : doc.swatches, colorMode, proof, proofEpoch],
  );

  // Ready also means the soft-proof colors are final: the memo above asked the source for the inks this render needs,
  // and the answer arrives with a new epoch, which renders again with the real colors and this true.
  const proofSettled = colorMode !== 'screen' || !!softProof || !!resolver || (getSoftProofSource()?.isSettled() ?? true);

  const faces = usedFontFaces(doc, pageId);
  const urls = usedImageUrls(doc, pageId, assetUrl);
  const fontEpoch = useSyncExternalStore(subscribeFonts, getFontEpoch, getFontEpoch);
  const resourceKey = JSON.stringify([faces, urls, fontEpoch]);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    setReady(false);
    void loadPageResources(faces, urls).then(() => live && setReady(true));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resourceKey]);

  const children: ReactNode[] = [];
  let svgRun: ReactNode[] = [];
  let runIndex = 0;
  const flush = () => {
    if (svgRun.length === 0) return;
    children.push(
      <svg
        key={`svg-${runIndex++}`}
        className="galley-svg"
        style={{ width: pt(geo.width), height: pt(geo.height) }}
        viewBox={`0 0 ${num(geo.width)} ${num(geo.height)}`}
        aria-hidden="true"
      >
        {svgRun}
      </svg>,
    );
    svgRun = [];
  };

  for (const frame of paintOrder(doc, pageId)) {
    if (!isLayerVisible(doc, frame.layerId)) continue;
    const common = { origin: geo.origin, colors };
    if (frame.type === 'rect' || frame.type === 'ellipse' || frame.type === 'line') {
      if (hasFill(frame) || hasStroke(frame)) svgRun.push(<ShapeSvg key={frame.id} frame={frame as ShapeFrame} shape={frame.type} parts="both" {...common} />);
    } else if (frame.type === 'text') {
      const story = doc.stories[frame.storyId];
      if (hasFill(frame)) svgRun.push(<ShapeSvg key={`${frame.id}:fill`} frame={frame} shape="rect" parts="fill" {...common} />);
      flush();
      if (story) children.push(<TextFrameView key={frame.id} frame={frame} story={story} paragraphStyles={doc.paragraphStyles} characterStyles={doc.characterStyles} {...common} />);
      if (hasStroke(frame)) svgRun.push(<ShapeSvg key={`${frame.id}:stroke`} frame={frame} shape="rect" parts="stroke" {...common} />);
    } else {
      const asset = frame.assetId === null ? undefined : doc.assets[frame.assetId];
      if (hasFill(frame)) svgRun.push(<ShapeSvg key={`${frame.id}:fill`} frame={frame} shape="rect" parts="fill" {...common} />);
      if (asset && frame.content) {
        flush();
        children.push(<ImageFrameView key={frame.id} frame={frame} asset={asset} origin={geo.origin} assetUrl={assetUrl} />);
      } else if (colorMode === 'screen') {
        svgRun.push(<EmptyImageMark key={`${frame.id}:x`} frame={frame} origin={geo.origin} />);
      }
      if (hasStroke(frame)) svgRun.push(<ShapeSvg key={`${frame.id}:stroke`} frame={frame} shape="rect" parts="stroke" {...common} />);
    }
  }
  flush();

  return (
    <div
      className={className ? `galley-page ${className}` : 'galley-page'}
      lang="en-US"
      data-galley-page={pageId}
      data-color-mode={colorMode}
      data-ready={ready && proofSettled ? 'true' : 'false'}
      style={{ width: pt(geo.width), height: pt(geo.height), ...style }}
    >
      {colorMode === 'screen' && (
        <div
          className="galley-paper"
          style={{ left: pt(geo.trim.x), top: pt(geo.trim.y), width: pt(geo.trim.width), height: pt(geo.trim.height), background: '#ffffff' }}
        />
      )}
      {colorMode === 'export' ? <ExportClip page={page} width={geo.width} height={geo.height}>{children}</ExportClip> : children}
    </div>
  );
}

/**
 * Export mode only: everything is clipped to the bleed box, so art that runs past the bleed (or into the slug) never
 * reaches the PDF. With bleed off the bleed box is the trim box, so the art is cut at the trim edge.
 */
function ExportClip({ page, width, height, children }: { page: Page; width: number; height: number; children: ReactNode }) {
  const c = bleedClipInsets(page);
  return (
    <div className="galley-clip" style={{ width: pt(width), height: pt(height), clipPath: `inset(${pt(c.top)} ${pt(c.right)} ${pt(c.bottom)} ${pt(c.left)})` }}>
      {children}
    </div>
  );
}
