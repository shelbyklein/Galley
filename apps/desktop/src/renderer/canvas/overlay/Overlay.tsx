import { getPage, type GalleyDocument, type Id, type Page } from '@galley/model';
import { Fragment, memo, type CSSProperties, type ReactElement } from 'react';
import { selectionBox } from '../../tools/selection-model';
import { selectDoc, useEditorStore } from '../../store';
import { useCanvasState } from '../canvasState';
import { handlePoint, HANDLES, type Handle, type OrientedBox } from '../geometry';
import { pageToView, type ViewTransform } from '../viewport';

/** Overlay metrics, CSS pixels. */
export const HANDLE_SIZE = 7;

const px = (n: number): number => Math.round(n);

/** A horizontal or vertical 1 px line across the whole pasteboard. */
function RulerGuideLine({ id, orientation, at, color }: { id: string; orientation: 'horizontal' | 'vertical'; at: number; color: string }) {
  const style: CSSProperties = orientation === 'horizontal' ? { left: 0, right: 0, top: px(at), height: 1, background: color } : { top: 0, bottom: 0, left: px(at), width: 1, background: color };
  return <div className="gl-guide gl-guide-ruler" data-guide-id={id} data-orientation={orientation} style={style} />;
}

/** A rectangle drawn as four 1 px lines (an unfilled box whose border sits exactly on the given edges). */
function GuideRect({ kind, x0, y0, x1, y1, color }: { kind: string; x0: number; y0: number; x1: number; y1: number; color: string }) {
  const left = px(x0);
  const top = px(y0);
  const style: CSSProperties = { left, top, width: Math.max(1, px(x1) - left + 1), height: Math.max(1, px(y1) - top + 1), border: `1px solid ${color}` };
  return <div className={`gl-guide gl-guide-${kind}`} data-guide-kind={kind} style={style} />;
}

/** Margin, column, bleed and slug guides, and the ruler guides of the page. */
const PageGuides = memo(function PageGuides({ doc, page, pageId, view }: { doc: GalleyDocument; page: Page; pageId: Id; view: ViewTransform }) {
  const at = (x: number, y: number) => pageToView(view, { x, y });
  const m = page.margins;
  const tl = at(m.left, m.top);
  const br = at(page.width - m.right, page.height - m.bottom);
  const items = [];

  // slug first (outermost), then bleed
  const slug = page.slug;
  if (slug.top + slug.right + slug.bottom + slug.left > 0) {
    const a = at(-slug.left, -slug.top);
    const b = at(page.width + slug.right, page.height + slug.bottom);
    items.push(<GuideRect key="slug" kind="slug" x0={a.x} y0={a.y} x1={b.x} y1={b.y} color="var(--gl-guide-slug)" />);
  }
  const bleed = page.bleed;
  if (bleed.top + bleed.right + bleed.bottom + bleed.left > 0) {
    const a = at(-bleed.left, -bleed.top);
    const b = at(page.width + bleed.right, page.height + bleed.bottom);
    items.push(<GuideRect key="bleed" kind="bleed" x0={a.x} y0={a.y} x1={b.x} y1={b.y} color="var(--gl-guide-bleed)" />);
  }
  items.push(<GuideRect key="margin" kind="margin" x0={tl.x} y0={tl.y} x1={br.x} y1={br.y} color="var(--gl-guide-margin)" />);

  const { count, gutter } = page.columns;
  if (count > 1) {
    const colWidth = (page.width - m.left - m.right - gutter * (count - 1)) / count;
    for (let i = 0; i < count; i++) {
      const left = m.left + i * (colWidth + gutter);
      // the margin rectangle already draws the outer edges of the first and last column
      const edges = [i > 0 ? left : null, i < count - 1 ? left + colWidth : null];
      edges.forEach((x, k) => {
        if (x === null) return;
        const v = at(x, 0).x;
        items.push(<div key={`col-${i}-${k}`} className="gl-guide gl-guide-column" data-guide-kind="column" style={{ left: px(v), top: px(tl.y), width: 1, height: px(br.y) - px(tl.y) + 1, background: 'var(--gl-guide-column)' }} />);
      });
    }
  }

  for (const g of Object.values(doc.guides)) {
    if (g.pageId !== pageId) continue;
    const p = at(g.orientation === 'vertical' ? g.position : 0, g.orientation === 'horizontal' ? g.position : 0);
    items.push(<RulerGuideLine key={g.id} id={g.id} orientation={g.orientation} at={g.orientation === 'vertical' ? p.x : p.y} color="var(--gl-guide-ruler)" />);
  }
  return <>{items}</>;
});

// ------------------------------------------------------------------------------------------------------ selection

const toViewBox = (view: ViewTransform, b: OrientedBox): OrientedBox => {
  const c = pageToView(view, { x: b.cx, y: b.cy });
  return { cx: c.x, cy: c.y, w: b.w * view.zoom, h: b.h * view.zoom, rotation: b.rotation };
};

function Outline({ box, color, line, id }: { box: OrientedBox; color: string; line?: boolean; id?: string }) {
  // an unrotated box sits on whole pixels so its 1 px border is crisp
  const crisp = box.rotation === 0;
  const left = crisp ? px(box.cx - box.w / 2) : box.cx - box.w / 2;
  const top = crisp ? px(box.cy - box.h / 2) : box.cy - box.h / 2;
  const width = crisp ? px(box.cx + box.w / 2) - left : box.w;
  const height = crisp ? px(box.cy + box.h / 2) - top : box.h;
  const style: CSSProperties = {
    left,
    top,
    width: Math.max(width, 1),
    height: line ? 0 : Math.max(height, 1),
    transform: box.rotation !== 0 ? `rotate(${box.rotation}deg)` : undefined,
  };
  if (line) style.borderTop = `1px solid ${color}`;
  else style.border = `1px solid ${color}`;
  return <div className="gl-outline" data-selected-id={id} style={style} />;
}

const HANDLE_LABEL: Record<Handle, string> = { nw: 'nw', n: 'n', ne: 'ne', e: 'e', se: 'se', s: 's', sw: 'sw', w: 'w' };

function SelectionLayer({ doc, ids, view }: { doc: GalleyDocument; ids: Id[]; view: ViewTransform }) {
  if (ids.length === 0) return null;
  const items: ReactElement[] = [];
  const colorOf = (id: Id) => doc.layers[doc.frames[id]?.layerId ?? '']?.color ?? '#4da3ff';

  // every selected object gets its own outline: a frame its rotated box, a group the bounds of its children
  for (const id of ids) {
    const sb = selectionBox(doc, [id]);
    if (!sb) continue;
    items.push(<Outline key={`o-${id}`} id={id} box={toViewBox(view, sb.box)} color={colorOf(id)} line={sb.line} />);
  }

  const sel = selectionBox(doc, ids);
  if (sel) {
    const box = toViewBox(view, sel.box);
    const color = colorOf(ids[0]!);
    if (ids.length > 1) items.push(<Outline key="all" box={box} color={color} />);
    const handles = sel.line ? (['e', 'w'] as Handle[]) : HANDLES;
    for (const h of handles) {
      const p = handlePoint(box, h);
      items.push(
        <div key={`h-${h}`} className="gl-handle" data-handle={HANDLE_LABEL[h]} style={{ left: px(p.x) - 3, top: px(p.y) - 3, width: HANDLE_SIZE, height: HANDLE_SIZE, borderColor: color }} />,
      );
    }
    if (sel.single && !sel.line) items.push(<div key="center" className="gl-center-mark" style={{ left: px(box.cx) - 3, top: px(box.cy) - 3, background: color }} />);
  }
  return <>{items}</>;
}

// ----------------------------------------------------------------------------------------------------- smart guides

function SmartGuides({ view }: { view: ViewTransform }) {
  const lines = useCanvasState((s) => s.smartGuides);
  if (lines.length === 0) return null;
  const pad = 8;
  return (
    <>
      {lines.map((l, i) => {
        const a = pageToView(view, l.axis === 'x' ? { x: l.value, y: l.from } : { x: l.from, y: l.value });
        const b = pageToView(view, l.axis === 'x' ? { x: l.value, y: l.to } : { x: l.to, y: l.value });
        const style: CSSProperties =
          l.axis === 'x' ? { left: px(a.x), top: px(a.y) - pad, width: 1, height: px(b.y) - px(a.y) + 2 * pad } : { top: px(a.y), left: px(a.x) - pad, height: 1, width: px(b.x) - px(a.x) + 2 * pad };
        const labelStyle: CSSProperties = l.axis === 'x' ? { left: px(a.x), top: px(b.y) + pad - 14 } : { left: px(b.x) + pad - 40, top: px(a.y) };
        return (
          <Fragment key={`${l.axis}-${l.value}-${i}`}>
            <div className="gl-smart-guide" data-axis={l.axis} data-value={l.value} style={style} />
            {l.label && (
              <div className="gl-smart-label" style={labelStyle}>
                {l.label}
              </div>
            )}
          </Fragment>
        );
      })}
    </>
  );
}

function Marquee() {
  const marquee = useCanvasState((s) => s.marquee);
  if (!marquee) return null;
  const { rect, kind } = marquee;
  return <div className={`gl-marquee gl-marquee-${kind}`} style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }} />;
}

/**
 * The interaction layer above the page: guides, selection outlines and handles, smart guides and the marquee. All of it is
 * editor chrome drawn in screen pixels over the pasteboard, never part of the page the renderer draws, so an exported
 * page cannot contain any of it. It has no pointer events of its own; Canvas.tsx handles the pointer and hit-tests in JS.
 */
export function Overlay({ view, pageId }: { view: ViewTransform; pageId: Id }) {
  const doc = useEditorStore(selectDoc);
  const selection = useEditorStore((s) => s.selection);
  const guidesVisible = useEditorStore((s) => s.view.guidesVisible);
  const page = getPage(doc, pageId);
  return (
    <div className="gl-overlay" data-testid="overlay">
      {guidesVisible && <PageGuides doc={doc} page={page} pageId={pageId} view={view} />}
      <SelectionLayer doc={doc} ids={selection} view={view} />
      <SmartGuides view={view} />
      <Marquee />
    </div>
  );
}
