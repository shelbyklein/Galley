import { addFrame, addSwatch, createDocument, groupFrames, paint, SWATCH_BLACK, type Frame } from '@galley/model';
import { beforeEach, describe, expect, it } from 'vitest';
import { selectDoc, useEditorStore } from '../store';
import { applyStrokeWeight, applySwatch, leafFrames, summarizePaint, summarizeWeight } from './paintTargets';

// the proxy decides whether a swatch click applies to the fill or the stroke
const shape = (id: string, props: Partial<Extract<Frame, { type: 'rect' }>> = {}): Frame => ({
  id,
  type: 'rect',
  name: '',
  layerId: 'layer',
  x: 0,
  y: 0,
  w: 10,
  h: 10,
  rotation: 0,
  fill: null,
  stroke: null,
  ...props,
});

beforeEach(() => {
  const s = useEditorStore.getState();
  s.openDocument(createDocument({ engineVersion: 'test' })); // a clean document and history on the shared singleton
  const doc = useEditorStore.getState().history.doc;
  const layerId = doc.layerOrder[0]!;
  const pageId = doc.pageOrder[0]!;
  s.dispatch(addSwatch, { swatch: { id: 'orange', name: 'Orange', type: 'cmyk', values: [0, 60, 100, 0] } });
  s.dispatch(addFrame, { frame: { ...shape('a'), layerId }, pageId });
  s.dispatch(addFrame, { frame: { ...shape('b', { stroke: { paint: paint(SWATCH_BLACK), weight: 3 } }), layerId }, pageId });
  useEditorStore.getState().setSelection(['a']);
});

const frame = (id: string) => selectDoc(useEditorStore.getState()).frames[id] as Extract<Frame, { type: 'rect' }>;

describe('applying a swatch to the selection', () => {
  it('fill: sets the fill, at the tint, and nothing else', () => {
    applySwatch('fill', 'orange', 60);
    expect(frame('a').fill).toEqual({ swatchId: 'orange', tint: 60, overprint: false });
    expect(frame('a').stroke).toBeNull();
  });

  it('stroke: sets the stroke paint and gives a frame without one a 1 pt weight; an existing weight stays', () => {
    applySwatch('stroke', 'orange', 100);
    expect(frame('a').stroke).toEqual({ paint: { swatchId: 'orange', tint: 100, overprint: false }, weight: 1 });
    useEditorStore.getState().setSelection(['b']);
    applySwatch('stroke', 'orange', 100);
    expect(frame('b').stroke!.weight).toBe(3);
    expect(frame('b').stroke!.paint.swatchId).toBe('orange');
  });

  it('[None] clears the target', () => {
    applySwatch('fill', 'orange', 100);
    applySwatch('fill', null, 100);
    expect(frame('a').fill).toBeNull();
    useEditorStore.getState().setSelection(['b']);
    applySwatch('stroke', null, 100);
    expect(frame('b').stroke).toBeNull();
  });

  it('is one undo step, however many frames are selected', () => {
    useEditorStore.getState().setSelection(['a', 'b']);
    const before = useEditorStore.getState().history.past.length;
    applySwatch('fill', 'orange', 100);
    expect(useEditorStore.getState().history.past.length).toBe(before + 1);
    expect(frame('a').fill?.swatchId).toBe('orange');
    expect(frame('b').fill?.swatchId).toBe('orange');
    useEditorStore.getState().undo();
    expect(frame('a').fill).toBeNull();
    expect(frame('b').fill).toBeNull();
  });

  it('does nothing with an empty selection', () => {
    useEditorStore.getState().clearSelection();
    const before = useEditorStore.getState().history;
    applySwatch('fill', 'orange', 100);
    expect(useEditorStore.getState().history).toBe(before);
  });

  it('applies through a group to its frames', () => {
    useEditorStore.getState().dispatch(groupFrames, { ids: ['a', 'b'], groupId: 'g' });
    useEditorStore.getState().setSelection(['g']);
    applySwatch('fill', 'orange', 100);
    expect(frame('a').fill?.swatchId).toBe('orange');
    expect(frame('b').fill?.swatchId).toBe('orange');
    expect(leafFrames(selectDoc(useEditorStore.getState()), ['g']).sort()).toEqual(['a', 'b']);
  });
});

describe('reading the selection', () => {
  it('summarizes fill and stroke as none, one paint, or mixed', () => {
    const doc = () => selectDoc(useEditorStore.getState());
    expect(summarizePaint(doc(), [], 'fill')).toEqual({ kind: 'empty' });
    expect(summarizePaint(doc(), ['a'], 'fill')).toEqual({ kind: 'none' });
    expect(summarizePaint(doc(), ['b'], 'stroke')).toMatchObject({ kind: 'paint' });
    expect(summarizePaint(doc(), ['a', 'b'], 'stroke')).toEqual({ kind: 'mixed' });
    expect(summarizeWeight(doc(), ['b'])).toBe(3);
    expect(summarizeWeight(doc(), ['a'])).toBeNull();
    expect(summarizeWeight(doc(), ['a', 'b'])).toBe('mixed');
  });

  it('stroke weight: a frame without a stroke gets a black one of that weight', () => {
    applyStrokeWeight(4);
    expect(frame('a').stroke).toEqual({ paint: { swatchId: SWATCH_BLACK, tint: 100, overprint: false }, weight: 4 });
  });
});
