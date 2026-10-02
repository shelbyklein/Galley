import { describe, expect, it } from 'vitest';
import {
  addFrame,
  canonicalStringify,
  CommandError,
  insertFrameInThread,
  isThreaded,
  linkFrames,
  redo,
  removeFrameFromThread,
  removeFrames,
  removePage,
  storyPlainText,
  threadFrames,
  threadPosition,
  undo,
  unlinkFrame,
  validateDocument,
  addPage,
  makePage,
  moveFramesToPage,
  type GalleyDocument,
  type HistoryState,
} from '../src';
import { history, run, textFrameArgs } from './helpers';

const valid = (h: HistoryState) => expect(validateDocument(h.doc)).toEqual([]);
const canon = (doc: GalleyDocument) => canonicalStringify(doc);

/** Runs a command, checks the document is valid, and that undo and redo reproduce the documents exactly. */
function checked<A>(h: HistoryState, command: Parameters<typeof run<A>>[1], args: A): HistoryState {
  const next = run(h, command, args);
  valid(next);
  const back = undo(next);
  expect(canon(back.doc)).toBe(canon(h.doc));
  expect(canon(redo(back).doc)).toBe(canon(next.doc));
  return next;
}

const frames = (h: HistoryState, storyId: string) => h.doc.stories[storyId]!.frameIds;

/** Three unthreaded text frames a, b, c, with a text "Alpha", b empty and c "Gamma". */
function three(): HistoryState {
  let h = run(history(), addFrame, textFrameArgs('a', 'sa', 'Alpha'));
  h = run(h, addFrame, textFrameArgs('b', 'sb', ''));
  h = run(h, addFrame, textFrameArgs('c', 'sc', 'Gamma'));
  return h;
}

describe('a text frame and its story', () => {
  it('start as a thread of one, and a story is added with its first frame only', () => {
    const h = three();
    expect(frames(h, 'sa')).toEqual(['a']);
    expect(threadPosition(h.doc, 'a')).toMatchObject({ index: 0, prev: null, next: null });
    expect(isThreaded(h.doc, 'a')).toBe(false);
    const args = textFrameArgs('d', 'sd');
    expect(() => run(h, addFrame, { ...args, story: { ...args.story!, frameIds: ['d', 'a'] } })).toThrow(/first frame only/);
    expect(run(h, addFrame, { ...args, story: { ...args.story!, frameIds: ['d'] } }).doc.stories.sd!.frameIds).toEqual(['d']);
  });
});

describe('thread.link', () => {
  it('joins the end of one thread to the start of another and appends the second text', () => {
    let h = three();
    h = checked(h, linkFrames, { fromId: 'a', toId: 'c' });
    expect(frames(h, 'sa')).toEqual(['a', 'c']);
    expect(h.doc.stories.sc).toBeUndefined();
    expect((h.doc.frames.c as { storyId: string }).storyId).toBe('sa');
    expect(storyPlainText(h.doc.stories.sa!.doc)).toBe('Alpha\nGamma');
    expect(threadFrames(h.doc, 'sa').map((f) => f.id)).toEqual(['a', 'c']);
    expect(threadPosition(h.doc, 'c')).toMatchObject({ index: 1, prev: 'a', next: null });
    expect(isThreaded(h.doc, 'c')).toBe(true);
  });

  it('adds nothing from an empty second story (the usual case: link to a fresh frame)', () => {
    let h = three();
    h = checked(h, linkFrames, { fromId: 'a', toId: 'b' });
    expect(storyPlainText(h.doc.stories.sa!.doc)).toBe('Alpha');
    h = checked(h, linkFrames, { fromId: 'b', toId: 'c' });
    expect(frames(h, 'sa')).toEqual(['a', 'b', 'c']);
    expect(storyPlainText(h.doc.stories.sa!.doc)).toBe('Alpha\nGamma');
  });

  it('joins whole threads', () => {
    let h = three();
    h = run(h, linkFrames, { fromId: 'a', toId: 'b' }); // a, b
    h = run(h, addFrame, textFrameArgs('d', 'sd', ''));
    h = run(h, linkFrames, { fromId: 'c', toId: 'd' }); // c, d
    h = checked(h, linkFrames, { fromId: 'b', toId: 'c' });
    expect(frames(h, 'sa')).toEqual(['a', 'b', 'c', 'd']);
  });

  it('rejects what a user could not do: same thread, from a frame that continues, to a frame that is continued, a non-text frame', () => {
    let h = three();
    h = run(h, linkFrames, { fromId: 'a', toId: 'b' });
    expect(() => run(h, linkFrames, { fromId: 'a', toId: 'b' })).toThrow(/already in the same thread/);
    expect(() => run(h, linkFrames, { fromId: 'a', toId: 'c' })).toThrow(/already continues/);
    expect(() => run(h, linkFrames, { fromId: 'c', toId: 'b' })).toThrow(/continuation/);
    expect(() => run(h, linkFrames, { fromId: 'c', toId: 'ghost' })).toThrow(CommandError);
    h = run(h, addFrame, { frame: { id: 'r', type: 'rect', name: '', layerId: 'layer_1', x: 0, y: 0, w: 10, h: 10, rotation: 0, fill: null, stroke: null }, pageId: 'page_1' });
    expect(() => run(h, linkFrames, { fromId: 'c', toId: 'r' })).toThrow(/not a text frame/);
  });

  it('threads across pages', () => {
    let h = three();
    h = run(h, addPage, { page: makePage({ id: 'page_2' }) });
    h = run(h, moveFramesToPage, { ids: ['c'], pageId: 'page_2' });
    h = checked(h, linkFrames, { fromId: 'a', toId: 'c' });
    expect(frames(h, 'sa')).toEqual(['a', 'c']);
  });
});

describe('thread.unlink and thread.remove', () => {
  const chain = (): HistoryState => {
    let h = three();
    h = run(h, addFrame, textFrameArgs('d', 'sd', ''));
    h = run(h, linkFrames, { fromId: 'a', toId: 'b' });
    h = run(h, linkFrames, { fromId: 'b', toId: 'c' });
    h = run(h, linkFrames, { fromId: 'c', toId: 'd' });
    return h; // a, b, c, d in story sa with "Alpha\nGamma"
  };

  it('break the thread before a frame: that frame and the rest become a new empty story, the text stays in front', () => {
    let h = chain();
    expect(frames(h, 'sa')).toEqual(['a', 'b', 'c', 'd']);
    h = checked(h, unlinkFrame, { frameId: 'c', newStoryId: 'sn' });
    expect(frames(h, 'sa')).toEqual(['a', 'b']);
    expect(frames(h, 'sn')).toEqual(['c', 'd']);
    expect(storyPlainText(h.doc.stories.sa!.doc)).toBe('Alpha\nGamma'); // all text stays; the first frames may be overset now
    expect(storyPlainText(h.doc.stories.sn!.doc)).toBe('');
    expect((h.doc.frames.d as { storyId: string }).storyId).toBe('sn');
    expect(() => run(h, unlinkFrame, { frameId: 'a', newStoryId: 'x' })).toThrow(/first of its thread/);
    expect(() => run(h, unlinkFrame, { frameId: 'c', newStoryId: 'sa' })).toThrow(/already exists/);
  });

  it('take one frame out of a thread: the thread closes up and the frame gets its own empty story', () => {
    let h = chain();
    h = checked(h, removeFrameFromThread, { frameId: 'b', newStoryId: 'sn' });
    expect(frames(h, 'sa')).toEqual(['a', 'c', 'd']);
    expect(frames(h, 'sn')).toEqual(['b']);
    h = checked(h, removeFrameFromThread, { frameId: 'a', newStoryId: 'sm' });
    expect(frames(h, 'sa')).toEqual(['c', 'd']);
    expect(() => run(history(), removeFrameFromThread, { frameId: 'x', newStoryId: 'y' })).toThrow(CommandError);
    expect(() => run(three(), removeFrameFromThread, { frameId: 'a', newStoryId: 'x' })).toThrow(/not part of a thread/);
  });
});

describe('thread.insert', () => {
  it('puts an empty unthreaded frame into a thread before or after a frame', () => {
    let h = three();
    h = run(h, linkFrames, { fromId: 'a', toId: 'c' }); // a, c
    h = run(h, addFrame, textFrameArgs('e', 'se', ''));
    h = checked(h, insertFrameInThread, { frameId: 'b', targetId: 'a', position: 'after' }); // a, b, c
    expect(frames(h, 'sa')).toEqual(['a', 'b', 'c']);
    h = checked(h, insertFrameInThread, { frameId: 'e', targetId: 'a', position: 'before' }); // e, a, b, c
    expect(frames(h, 'sa')).toEqual(['e', 'a', 'b', 'c']);
    expect(h.doc.stories.sb).toBeUndefined();
    expect(h.doc.stories.se).toBeUndefined();
    expect(storyPlainText(h.doc.stories.sa!.doc)).toBe('Alpha\nGamma');
  });

  it('refuses a frame that has text, is already threaded, or is already in that thread', () => {
    let h = three();
    h = run(h, addFrame, textFrameArgs('d', 'sd', ''));
    expect(() => run(h, insertFrameInThread, { frameId: 'c', targetId: 'a', position: 'after' })).toThrow(/empty frame/);
    h = run(h, linkFrames, { fromId: 'a', toId: 'b' });
    expect(() => run(h, insertFrameInThread, { frameId: 'b', targetId: 'c', position: 'after' })).toThrow(/same thread|part of a thread/);
    expect(() => run(h, insertFrameInThread, { frameId: 'd', targetId: 'a', position: 'sideways' as 'after' })).toThrow(/position/);
  });
});

describe('deleting frames keeps threads valid', () => {
  it('deleting a frame in the middle closes the thread; deleting the last frame deletes the story', () => {
    let h = three();
    h = run(h, linkFrames, { fromId: 'a', toId: 'b' });
    h = run(h, linkFrames, { fromId: 'b', toId: 'c' });
    h = checked(h, removeFrames, { ids: ['b'] });
    expect(frames(h, 'sa')).toEqual(['a', 'c']);
    h = checked(h, removeFrames, { ids: ['a', 'c'] });
    expect(h.doc.stories).toEqual({});
  });

  it('deleting a page deletes its frames out of threads that continue on other pages', () => {
    let h = three();
    h = run(h, addPage, { page: makePage({ id: 'page_2' }) });
    h = run(h, moveFramesToPage, { ids: ['c'], pageId: 'page_2' });
    h = run(h, linkFrames, { fromId: 'a', toId: 'c' });
    h = checked(h, removePage, { id: 'page_2' });
    expect(frames(h, 'sa')).toEqual(['a']);
    expect(storyPlainText(h.doc.stories.sa!.doc)).toBe('Alpha\nGamma'); // the text stays in the story, now overset
  });
});
