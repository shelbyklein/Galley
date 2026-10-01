import { describe, expect, it } from 'vitest';
import {
  addFrame,
  applyCommand,
  beginTransaction,
  canRedo,
  canUndo,
  cancelTransaction,
  canonicalStringify,
  closeCoalescing,
  commitTransaction,
  CommandError,
  historyRevision,
  moveFrames,
  redo,
  redoLabel,
  removeFrames,
  setFrameProps,
  setMeta,
  undo,
  undoLabel,
} from '../src';
import { baseDoc, history, rectFrame, run } from './helpers';

const withRect = () => run(history(), addFrame, { frame: rectFrame('r1', { x: 10, y: 20 }), pageId: 'page_1' });

describe('history', () => {
  it('applies, undoes and redoes a command', () => {
    const h0 = history();
    const h1 = run(h0, addFrame, { frame: rectFrame('r1'), pageId: 'page_1' });
    expect(h1.doc.frames.r1).toBeDefined();
    expect(undoLabel(h1)).toBe('Add Frame');
    const h2 = undo(h1);
    expect(h2.doc.frames.r1).toBeUndefined();
    expect(canonicalStringify(h2.doc)).toBe(canonicalStringify(h0.doc));
    expect(canUndo(h2)).toBe(false);
    expect(redoLabel(h2)).toBe('Add Frame');
    const h3 = redo(h2);
    expect(canonicalStringify(h3.doc)).toBe(canonicalStringify(h1.doc));
    expect(canRedo(h3)).toBe(false);
  });

  it('a command that changes nothing leaves no undo step and returns the same state', () => {
    const h = withRect();
    const same = run(h, moveFrames, { ids: ['r1'], dx: 0, dy: 0 });
    expect(same).toBe(h);
    expect(same.past.length).toBe(1);
  });

  it('a rejected command leaves the state untouched', () => {
    const h = withRect();
    expect(() => run(h, removeFrames, { ids: ['nope'] })).toThrow(CommandError);
    expect(h.past.length).toBe(1);
  });

  it('a new command clears the redo stack', () => {
    let h = withRect();
    h = undo(h);
    expect(canRedo(h)).toBe(true);
    h = run(h, setMeta, { title: 'Other' });
    expect(canRedo(h)).toBe(false);
  });

  it('a simulated drag of 50 moves in a transaction is exactly one undo step', () => {
    const start = withRect();
    let h = beginTransaction(start, 'Move');
    for (let i = 0; i < 50; i++) h = applyCommand(h, moveFrames, { ids: ['r1'], dx: 1.5, dy: -0.5 });
    // the document follows the pointer live
    expect(h.doc.frames.r1).toMatchObject({ x: 10 + 75, y: 20 - 25 });
    expect(h.past.length).toBe(1); // nothing committed yet
    h = commitTransaction(h);
    expect(h.past.length).toBe(2); // the add, plus the whole drag
    expect(undoLabel(h)).toBe('Move');

    h = undo(h);
    expect(h.doc.frames.r1).toMatchObject({ x: 10, y: 20 });
    expect(canonicalStringify(h.doc)).toBe(canonicalStringify(start.doc));
    h = redo(h);
    expect(h.doc.frames.r1).toMatchObject({ x: 85, y: -5 });
  });

  it('a drag of 50 moves coalesced by key is also one undo step', () => {
    const start = withRect();
    let h = start;
    for (let i = 0; i < 50; i++) h = applyCommand(h, moveFrames, { ids: ['r1'], dx: 1, dy: 1 }, { coalesceKey: 'drag-1' });
    expect(h.past.length).toBe(2);
    h = undo(h);
    expect(canonicalStringify(h.doc)).toBe(canonicalStringify(start.doc));
  });

  it('coalescing ends on a different key, on closeCoalescing, and on undo/redo', () => {
    let h = withRect();
    h = applyCommand(h, setFrameProps, { ids: ['r1'], props: { x: 1 } }, { coalesceKey: 'x' });
    h = applyCommand(h, setFrameProps, { ids: ['r1'], props: { x: 2 } }, { coalesceKey: 'x' });
    expect(h.past.length).toBe(2);
    h = applyCommand(h, setFrameProps, { ids: ['r1'], props: { y: 1 } }, { coalesceKey: 'y' });
    expect(h.past.length).toBe(3);
    h = applyCommand(h, setFrameProps, { ids: ['r1'], props: { y: 2 } }, { coalesceKey: 'y' });
    h = closeCoalescing(h);
    h = applyCommand(h, setFrameProps, { ids: ['r1'], props: { y: 3 } }, { coalesceKey: 'y' });
    expect(h.past.length).toBe(4);
    h = undo(h);
    h = redo(h);
    h = applyCommand(h, setFrameProps, { ids: ['r1'], props: { y: 4 } }, { coalesceKey: 'y' });
    expect(h.past.length).toBe(5);
  });

  it('cancelling a transaction restores the document from before it began', () => {
    const start = withRect();
    let h = beginTransaction(start, 'Move');
    h = applyCommand(h, moveFrames, { ids: ['r1'], dx: 30, dy: 30 });
    h = cancelTransaction(h);
    expect(h.doc).toBe(start.doc);
    expect(h.past.length).toBe(1);
  });

  it('an empty transaction leaves no step, and undo is ignored while one is open', () => {
    const start = withRect();
    let h = commitTransaction(beginTransaction(start, 'Nothing'));
    expect(h.past.length).toBe(1);
    h = beginTransaction(start, 'Open');
    expect(undo(h)).toBe(h);
    expect(canUndo(h)).toBe(false);
    expect(() => beginTransaction(h, 'Nested')).toThrow(/already open/);
  });

  it('tracks a dirty revision: undoing back to the saved state is clean again', () => {
    let h = history();
    const saved = historyRevision(h);
    h = run(h, setMeta, { title: 'A' });
    expect(historyRevision(h)).not.toBe(saved);
    h = undo(h);
    expect(historyRevision(h)).toBe(saved);
    h = run(h, setMeta, { title: 'B' });
    const afterB = historyRevision(h);
    h = undo(h);
    h = run(h, setMeta, { title: 'C' });
    expect(historyRevision(h)).not.toBe(afterB); // a different state never reuses a revision
  });

  it('a coalesced change moves the revision even though the step count does not', () => {
    let h = withRect();
    h = applyCommand(h, setFrameProps, { ids: ['r1'], props: { x: 1 } }, { coalesceKey: 'x' });
    const saved = historyRevision(closeCoalescing(h));
    h = applyCommand(h, setFrameProps, { ids: ['r1'], props: { x: 2 } }, { coalesceKey: 'x' });
    expect(historyRevision(h)).not.toBe(saved);
  });

  it('the starting document is not mutated and stays frozen-safe', () => {
    const doc = baseDoc();
    const before = canonicalStringify(doc);
    const h = run(history(doc), addFrame, { frame: rectFrame('r1'), pageId: 'page_1' });
    expect(canonicalStringify(doc)).toBe(before);
    expect(Object.isFrozen(h.doc)).toBe(true);
  });
});
