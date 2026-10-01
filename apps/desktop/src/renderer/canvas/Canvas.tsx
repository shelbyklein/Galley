import { sheetGeometry, PageView } from '@galley/render';
import { sheetSize } from '@galley/model';
import { useLayoutEffect, useRef } from 'react';
import { assetUrl } from '../../shared/assets';
import { selectDoc, useEditorStore } from '../store';
import './canvas.css';

/** Pasteboard padding around the page when fitting, in screen pixels. */
const FIT_PADDING = 24;

/**
 * Editor canvas: the pasteboard and the current page, drawn by @galley/render in screen mode.
 *
 * Lane B owns this folder and replaces this placeholder with the real viewport (zoom, pan, rulers), the interaction
 * overlay (selection, guides, handles) and the tools. What stays: the page is drawn only by `PageView` (never by
 * canvas code), and editor chrome lives in a separate layer above it, so exports never contain chrome.
 *
 * Placeholder behavior: the page is centered at the store's `viewport.zoom` (CSS px per pt) and fitted to the window
 * while `viewport.fit` is true.
 */
export function Canvas() {
  const doc = useEditorStore(selectDoc);
  const pageId = useEditorStore((s) => s.currentPageId);
  const zoom = useEditorStore((s) => s.viewport.zoom);
  const fit = useEditorStore((s) => s.viewport.fit);
  const ref = useRef<HTMLDivElement>(null);
  const setViewport = useEditorStore((s) => s.setViewport);

  const page = doc.pages[pageId]!;
  const sheet = sheetSize(page);
  const geo = sheetGeometry(page);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !fit) return;
    const refit = () => {
      const z = Math.min((el.clientWidth - 2 * FIT_PADDING) / sheet.width, (el.clientHeight - 2 * FIT_PADDING) / sheet.height);
      if (z > 0 && Math.abs(z - zoom) > 1e-6) setViewport({ zoom: z });
    };
    refit();
    const observer = new ResizeObserver(refit);
    observer.observe(el);
    return () => observer.disconnect();
  }, [fit, sheet.width, sheet.height, zoom, setViewport]);

  // PageView lays out at 1 pt = 4/3 CSS px; scale by zoom (px per pt) to get the on-screen size.
  const scale = zoom * 0.75;
  return (
    <div ref={ref} className="gl-pasteboard" data-testid="canvas" data-zoom={zoom.toFixed(4)}>
      <div
        className="gl-page-slot"
        style={{ width: sheet.width * zoom, height: sheet.height * zoom, marginLeft: -(sheet.width * zoom) / 2, marginTop: -(sheet.height * zoom) / 2 }}
      >
        <div className="gl-page-scale" style={{ transform: `scale(${scale})` }}>
          {/* the page's drop shadow, behind the paper (editor chrome: it lives here, never in the renderer) */}
          <div
            className="gl-page-shadow"
            style={{ left: `${geo.trim.x + 4}pt`, top: `${geo.trim.y + 5}pt`, width: `${geo.trim.width}pt`, height: `${geo.trim.height}pt` }}
          />
          <PageView doc={doc} pageId={pageId} colorMode="screen" assetUrl={(asset) => assetUrl(asset.path)} />
        </div>
      </div>
    </div>
  );
}
