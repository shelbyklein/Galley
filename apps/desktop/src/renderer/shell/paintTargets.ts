/**
 * The fill and stroke of the selection: reading them for the proxy and the control strip, and applying a swatch.
 * "Fill/stroke target follows the proxy" means a swatch click applies to `shellStore.proxyTarget`.
 * Pure functions plus two actions that dispatch model commands as single undo steps. Owned by lane C.
 */
import { paint as makePaint, setFrameProps, SWATCH_BLACK, type GalleyDocument, type Id, type Paint, type Stroke } from '@galley/model';
import { selectDoc, useEditorStore } from '../store';
import type { ProxyTarget } from './shellStore';

export type PaintState = { kind: 'empty' } | { kind: 'none' } | { kind: 'paint'; paint: Paint } | { kind: 'mixed' };

/** The non-group frames a selection covers (a group expands to its leaves). */
export function leafFrames(doc: GalleyDocument, ids: readonly Id[]): Id[] {
  const out: Id[] = [];
  const seen = new Set<Id>();
  const visit = (id: Id) => {
    const f = doc.frames[id];
    if (!f || seen.has(id)) return;
    seen.add(id);
    if (f.type === 'group') f.childIds.forEach(visit);
    else out.push(id);
  };
  ids.forEach(visit);
  return out;
}

const samePaint = (a: Paint | null, b: Paint | null) =>
  a === b || (a !== null && b !== null && a.swatchId === b.swatchId && a.tint === b.tint && a.overprint === b.overprint);

function paintOf(doc: GalleyDocument, id: Id, target: ProxyTarget): Paint | null {
  const f = doc.frames[id] as { fill?: Paint | null; stroke?: Stroke | null };
  return target === 'fill' ? (f.fill ?? null) : (f.stroke?.paint ?? null);
}

/** What the proxy shows for one target: nothing selected, [None], one paint, or a mix. A line has no fill, so it is skipped for fills. */
export function summarizePaint(doc: GalleyDocument, leafIds: readonly Id[], target: ProxyTarget): PaintState {
  const ids = target === 'fill' ? leafIds.filter((id) => doc.frames[id]!.type !== 'line') : leafIds;
  if (ids.length === 0) return { kind: 'empty' };
  const first = paintOf(doc, ids[0]!, target);
  for (const id of ids) if (!samePaint(first, paintOf(doc, id, target))) return { kind: 'mixed' };
  return first ? { kind: 'paint', paint: first } : { kind: 'none' };
}

/** The stroke weight of the selection: a number, `mixed`, or null when nothing has a stroke. */
export function summarizeWeight(doc: GalleyDocument, leafIds: readonly Id[]): number | 'mixed' | null {
  if (leafIds.length === 0) return null;
  const weights = leafIds.map((id) => (doc.frames[id] as { stroke?: Stroke | null }).stroke?.weight ?? null);
  const first = weights[0]!;
  if (weights.some((w) => w !== first)) return 'mixed';
  return first;
}

/**
 * Apply a swatch (or [None] with `swatchId` null) to the fill or stroke of every frame in the selection, at `tint`.
 * One undo step. A stroke keeps its weight; a frame that had no stroke gets a 1 pt one. Overprint is kept.
 */
export function applySwatch(target: ProxyTarget, swatchId: Id | null, tint: number): void {
  const state = useEditorStore.getState();
  const doc = selectDoc(state);
  const leaves = leafFrames(doc, state.selection).filter((id) => target === 'stroke' || doc.frames[id]!.type !== 'line');
  if (leaves.length === 0) return;
  state.beginTransaction(target === 'fill' ? 'Apply Fill' : 'Apply Stroke');
  try {
    for (const id of leaves) {
      const f = doc.frames[id] as { fill?: Paint | null; stroke?: Stroke | null };
      const overprint = (target === 'fill' ? f.fill?.overprint : f.stroke?.paint.overprint) ?? false;
      const next = swatchId === null ? null : makePaint(swatchId, tint, overprint);
      const props = target === 'fill' ? { fill: next } : { stroke: next ? ({ paint: next, weight: f.stroke?.weight ?? 1 } satisfies Stroke) : null };
      useEditorStore.getState().dispatch(setFrameProps, { ids: [id], props });
    }
  } finally {
    useEditorStore.getState().commitTransaction();
  }
}

/** Set the stroke weight of the selection. A frame with no stroke gets a [Black] one. One undo step. */
export function applyStrokeWeight(weight: number): void {
  const state = useEditorStore.getState();
  const doc = selectDoc(state);
  const leaves = leafFrames(doc, state.selection);
  if (leaves.length === 0 || !Number.isFinite(weight) || weight < 0) return;
  state.beginTransaction('Stroke Weight');
  try {
    for (const id of leaves) {
      const f = doc.frames[id] as { stroke?: Stroke | null };
      const stroke: Stroke = { paint: f.stroke?.paint ?? makePaint(SWATCH_BLACK, 100, false), weight };
      useEditorStore.getState().dispatch(setFrameProps, { ids: [id], props: { stroke } });
    }
  } finally {
    useEditorStore.getState().commitTransaction();
  }
}
