import { PageView, sheetGeometry } from '@galley/render';
import { sheetInsets, type Asset } from '@galley/model';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { assetUrl } from '../../shared/assets';
import { selectDoc, useEditorStore } from '../store';
import { beginToolGesture, cursorFor, handleDoubleClick, normalizeTool } from '../tools/tools';
import { GuideCreateGesture } from '../tools/gestures/guides';
import { pointerInfo, type Gesture, type GestureContext } from '../tools/gestures/types';
import { exitTextEdit, TextEditor } from '../tools/text-edit/TextEditor';
import { canvasState, patchCanvasState, useCanvasState } from './canvasState';
import { isEditableElement } from './dom';
import { Overlay } from './overlay/Overlay';
import { Rulers, RULER_SIZE } from './rulers/Rulers';
import { useCanvasKeys } from './useCanvasKeys';
import { clampZoom, fitPage, formatZoom, sameView, zoomAt, type ViewTransform } from './viewport';
import './canvas.css';

/** Stable so the memoized page view does not re-render when only the view changes. */
const assetUrlFn = (asset: Asset) => assetUrl(asset.path);
const MemoPageView = memo(PageView);

/**
 * The editor canvas: rulers, the pasteboard, the current page, and the interaction layer.
 *
 *   rulers          chrome, origin at the page's top-left, units from the View settings
 *   pasteboard      `.gl-viewport`, where the page layer and the overlay live; pointer events are handled here
 *   page layer      the page drawn by @galley/render's PageView (never by canvas code), scaled by the zoom with a CSS
 *                   transform; the in-place text editor sits in it so it scales with the page
 *   overlay         guides, selection, handles, smart guides, marquee (editor chrome, never in an export)
 *
 * The view (zoom, pan) lives in the editor store; while `viewport.fit` is true this component computes it from the
 * window size and writes it back, so everything else reads one source of truth.
 */
export function Canvas() {
  const doc = useEditorStore(selectDoc);
  const pageId = useEditorStore((s) => s.currentPageId);
  const stored = useEditorStore((s) => s.viewport);
  const settings = useEditorStore((s) => s.view);
  const tool = useEditorStore((s) => s.activeTool);
  const size = useCanvasState((s) => s.size);
  const cursor = useCanvasState((s) => s.cursor);
  const textEdit = useCanvasState((s) => s.textEdit);
  const rootRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const active = useRef<{ gesture: Gesture; pointerId: number } | null>(null);

  const page = doc.pages[pageId]!;
  const geo = sheetGeometry(page);
  const insets = sheetInsets(page);

  // ---- size: measure the pasteboard (it changes with the window and with the rulers)
  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const cur = canvasState().size;
      if (!cur || cur.width !== r.width || cur.height !== r.height) patchCanvasState({ size: { width: r.width, height: r.height } });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [settings.rulersVisible]);

  // ---- view: fitted while `fit`, else the stored zoom and pan
  const fitted = stored.fit && size ? fitPage(size, page) : null;
  const view: ViewTransform = fitted ?? stored;
  useLayoutEffect(() => {
    if (fitted && !sameView(fitted, stored)) useEditorStore.getState().setViewport(fitted);
  }, [fitted?.zoom, fitted?.panX, fitted?.panY, stored.zoom, stored.panX, stored.panY, stored.fit]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- gesture context: everything read fresh from the stores, so it never goes stale
  const ctx = useMemo<GestureContext>(
    () => ({
      store: useEditorStore,
      view: () => useEditorStore.getState().viewport,
      size: () => canvasState().size ?? { width: 1078, height: 782 },
      doc: () => useEditorStore.getState().history.doc,
      pageId: () => useEditorStore.getState().currentPageId,
    }),
    [],
  );

  const infoFor = useCallback(
    (e: { clientX: number; clientY: number; shiftKey: boolean; altKey: boolean; metaKey: boolean; ctrlKey: boolean; detail: number }) => {
      const r = viewportRef.current!.getBoundingClientRect();
      return pointerInfo(e, { x: r.left, y: r.top }, ctx.view());
    },
    [ctx],
  );

  const refreshCursor = useCallback(
    (e: { clientX: number; clientY: number; altKey: boolean }) => {
      if (active.current) return;
      const r = viewportRef.current!.getBoundingClientRect();
      const next = cursorFor(ctx, normalizeTool(useEditorStore.getState().activeTool), canvasState().spaceHeld, { x: e.clientX - r.left, y: e.clientY - r.top }, e.altKey);
      if (next !== canvasState().cursor) patchCanvasState({ cursor: next });
    },
    [ctx],
  );

  const endGesture = useCallback((cancel: boolean) => {
    const a = active.current;
    if (!a) return;
    active.current = null;
    if (cancel) a.gesture.cancel();
    try {
      rootRef.current?.releasePointerCapture(a.pointerId);
    } catch {
      // the pointer is already gone
    }
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.button !== 1) return;
    const target = e.target as HTMLElement;
    if (target.closest('[data-text-editor]')) return; // the browser owns the caret and selection inside the editor
    if (active.current) endGesture(true);
    if (canvasState().textEdit) exitTextEdit();
    if (isEditableElement(document.activeElement)) (document.activeElement as HTMLElement).blur();

    const info = infoFor(e);
    const ruler = target.closest<HTMLElement>('[data-ruler]')?.dataset.ruler;
    let gesture: Gesture | null = null;
    if (ruler) gesture = new GuideCreateGesture(ctx, ruler === 'top' ? 'horizontal' : 'vertical', info);
    else if (target.closest('.gl-viewport')) gesture = beginToolGesture(ctx, normalizeTool(useEditorStore.getState().activeTool), info, e.button === 1 || canvasState().spaceHeld);
    e.preventDefault();
    if (gesture) {
      active.current = { gesture, pointerId: e.pointerId };
      rootRef.current?.setPointerCapture(e.pointerId);
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (active.current) {
      // Chromium can deliver a hover move while a captured pointer is held elsewhere (including after capture).
      // Only the pointer with a pressed button owns this gesture; hover and other pointers cannot move the document.
      if (e.pointerId !== active.current.pointerId || e.buttons === 0) return;
      active.current.gesture.move(infoFor(e));
    }
    else refreshCursor(e);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const a = active.current;
    if (!a || e.pointerId !== a.pointerId) return;
    active.current = null;
    try {
      rootRef.current?.releasePointerCapture(a.pointerId);
    } catch {
      // already released
    }
    a.gesture.up(infoFor(e));
    refreshCursor(e);
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('[data-text-editor]')) return;
    handleDoubleClick(ctx, infoFor(e));
  };

  // ---- wheel: two-finger scroll pans, pinch (ctrl + wheel) and alt + wheel zoom about the pointer
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const vp = viewportRef.current;
      if (!vp) return;
      e.preventDefault();
      const s = useEditorStore.getState();
      const v = s.viewport;
      if (e.ctrlKey || e.altKey) {
        const r = vp.getBoundingClientRect();
        const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0025));
        s.setViewport({ ...zoomAt(v, clampZoom(v.zoom * factor), { x: e.clientX - r.left, y: e.clientY - r.top }), fit: false });
        return;
      }
      const dx = e.shiftKey && e.deltaX === 0 ? e.deltaY : e.deltaX;
      const dy = e.shiftKey && e.deltaX === 0 ? 0 : e.deltaY;
      s.setViewport({ panX: v.panX - dx, panY: v.panY - dy, fit: false });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // ---- Escape cancels a gesture in progress; the canvas going away cancels it too
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && active.current) endGesture(true);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      endGesture(true);
    };
  }, [endGesture]);
  useCanvasKeys();

  // ---- leaving the type tool ends in-place editing; the cursor follows the tool
  useEffect(() => {
    if (normalizeTool(tool) !== 'type' && canvasState().textEdit) exitTextEdit();
    if (!active.current) patchCanvasState({ cursor: cursorFor(ctx, normalizeTool(tool), canvasState().spaceHeld, { x: -1, y: -1 }, false) });
  }, [tool, ctx]);

  const scale = view.zoom * 0.75; // PageView lays out at 1 pt = 4/3 CSS px
  const shadow = { left: `${geo.trim.x + 3 / view.zoom}pt`, top: `${geo.trim.y + 4 / view.zoom}pt`, width: `${geo.trim.width}pt`, height: `${geo.trim.height}pt` };

  return (
    <div
      ref={rootRef}
      className={`gl-canvas-root${settings.rulersVisible ? '' : ' gl-no-rulers'}`}
      style={{ cursor, ['--gl-ruler-size' as string]: `${RULER_SIZE}px` }}
      data-testid="canvas"
      data-zoom={view.zoom.toFixed(4)}
      data-zoom-label={formatZoom(view.zoom)}
      data-tool={tool}
      data-units={settings.units}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => endGesture(true)}
      onDoubleClick={onDoubleClick}
    >
      {settings.rulersVisible && size && <Rulers size={size} view={view} units={settings.units} />}
      <div ref={viewportRef} className="gl-viewport" data-testid="canvas-viewport">
        <div className="gl-page-layer" style={{ transform: `translate(${view.panX - insets.left * view.zoom}px, ${view.panY - insets.top * view.zoom}px) scale(${scale})` }}>
          {/* the page's drop shadow, behind the paper (editor chrome: it lives here, never in the renderer) */}
          <div className="gl-page-shadow" style={shadow} />
          <MemoPageView doc={doc} pageId={pageId} colorMode="screen" assetUrl={assetUrlFn} />
          {textEdit && <TextEditor key={textEdit.frameId} frameId={textEdit.frameId} caret={textEdit.caret} />}
        </div>
        <Overlay view={view} pageId={pageId} />
      </div>
    </div>
  );
}
