import { addFrame, createDocument, createStory, normalizeStoryDoc, textNode } from '@galley/model';
import { describe, expect, it } from 'vitest';
import { createEditorStore } from '../../../store/editorStore';
import { storyPointAt, textContext, textTargets } from './targets';
describe('formatting selection contracts', () => {
  it('maps reversed and cross-paragraph PM ranges with block boundary positions', () => {
    const doc = normalizeStoryDoc({ type: 'doc', content: [{ type: 'paragraph', content: [textNode('One')] }, { type: 'paragraph', content: [textNode('Two🙂')] }] });
    expect(storyPointAt(doc, 1)).toEqual({ paragraph: 0, offset: 0 });
    expect(storyPointAt(doc, 4)).toEqual({ paragraph: 0, offset: 3 });
    expect(storyPointAt(doc, 6)).toEqual({ paragraph: 1, offset: 0 });
    expect(storyPointAt(doc, 11)).toEqual({ paragraph: 1, offset: 5 });
    const store = createEditorStore(createDocument({ engineVersion: 'test', page: { id: 'p' }, layer: { id: 'l' } }));
    store.getState().dispatch(addFrame, { pageId: 'p', frame: { id: 'f', type: 'text', name: '', layerId: 'l', x: 0, y: 0, w: 100, h: 100, rotation: 0, fill: null, stroke: null, storyId: 's', inset: 0 }, story: { ...createStory('s', ''), doc } });
    store.getState().setTextSelection({ storyId: 's', anchor: 9, head: 2 });
    expect(textTargets(store.getState())).toEqual([{ storyId: 's', range: { from: { paragraph: 0, offset: 1 }, to: { paragraph: 1, offset: 3 } } }]);
    store.getState().setTextSelection({ storyId: 's', anchor: 2, head: 2 });
    const pending = { storyId: 's', position: 2, marks: [{ type: 'override', attrs: { print: { fontSize: 20 } } }] };
    expect(textContext(store.getState(), pending)?.run.fontSize).toBe(20);
    expect(textContext(store.getState(), pending)?.overridden).toBe(true);
    expect(textContext(store.getState(), { ...pending, position: 3 })?.run.fontSize).toBe(12);
    expect(store.getState().history.doc.stories.s!.doc).toEqual(doc);
    store.getState().setTextSelection(null); store.getState().setSelection(['f']);
    expect(textTargets(store.getState())[0]!.range).toEqual({ from: { paragraph: 0, offset: 0 }, to: { paragraph: 1, offset: 5 } });
  });
});
