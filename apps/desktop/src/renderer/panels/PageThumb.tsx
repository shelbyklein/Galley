import { isLayerVisible, paintOrder, paragraphAttrs, resolveParagraph, type BoxFrame, type GalleyDocument, type Id } from '@galley/model';
import type { ColorResolver } from '@galley/render';
import type { CSSProperties } from 'react';
import { assetUrl } from '../../shared/assets';

/**
 * A page thumbnail for the Pages panel: the page's frames as simple colored boxes (fills, strokes, text as faint
 * lines, images as their picture), scaled to fit `maxW` x `maxH`. It is a preview of the layout, not a second page
 * renderer: the real page is only ever drawn by `PageView` in @galley/render.
 */
export function PageThumb({ doc, pageId, colors, maxW, maxH }: { doc: GalleyDocument; pageId: Id; colors: ColorResolver; maxW: number; maxH: number }) {
  const page = doc.pages[pageId]!;
  const scale = Math.min(maxW / page.width, maxH / page.height);
  const frames = paintOrder(doc, pageId).filter((f) => isLayerVisible(doc, f.layerId));
  return (
    <div className="gl-thumb" style={{ width: page.width * scale, height: page.height * scale }} data-testid="page-thumb">
      {frames.map((f) => (
        <ThumbFrame key={f.id} doc={doc} frame={f} scale={scale} colors={colors} />
      ))}
    </div>
  );
}

function ThumbFrame({ doc, frame, scale, colors }: { doc: GalleyDocument; frame: BoxFrame; scale: number; colors: ColorResolver }) {
  const style: CSSProperties = {
    left: frame.x * scale,
    top: frame.y * scale,
    width: frame.w * scale,
    height: frame.h * scale,
    transform: frame.rotation !== 0 ? `rotate(${frame.rotation}deg)` : undefined,
  };
  const stroke = frame.stroke && frame.stroke.weight > 0 ? colors.css(frame.stroke.paint) : null;
  const strokeWidth = Math.max(0.5, (frame.stroke?.weight ?? 0) * scale);
  if (frame.type === 'line') {
    return <div className="gl-thumb-frame" style={{ ...style, height: 0, borderTop: stroke ? `${strokeWidth}px solid ${stroke}` : undefined }} />;
  }
  if (frame.fill) style.background = colors.css(frame.fill);
  if (stroke) style.boxShadow = `inset 0 0 0 ${strokeWidth}px ${stroke}`;
  if (frame.type === 'ellipse') style.borderRadius = '50%';
  if (frame.type === 'text') {
    const story = doc.stories[frame.storyId];
    // the thumbnail's text bar takes the color of the story's first paragraph
    const ink = story ? colors.css(resolveParagraph(doc, paragraphAttrs(story.doc.content![0]!)).fill) : 'currentColor';
    return <div className="gl-thumb-frame gl-thumb-text" style={{ ...style, color: ink }} />;
  }
  if (frame.type === 'image') {
    const asset = frame.assetId ? doc.assets[frame.assetId] : undefined;
    const c = frame.content;
    return (
      <div className="gl-thumb-frame gl-thumb-image" style={style}>
        {asset && c && <img src={assetUrl(asset.path)} alt="" draggable={false} style={{ left: c.x * scale, top: c.y * scale, width: c.w * scale, height: c.h * scale }} />}
      </div>
    );
  }
  return <div className="gl-thumb-frame" style={style} />;
}
