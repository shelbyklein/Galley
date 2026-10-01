/**
 * Undo/redo over Immer patches. A pure, immutable state machine: every function takes a `HistoryState` and returns a
 * new one, so it drops straight into a Zustand store (and into tests) with no hidden state.
 *
 *   const h0 = createHistory(doc)
 *   const h1 = applyCommand(h0, moveFrames, { ids, dx: 5, dy: 0 })      // one undo step
 *   const h2 = undo(h1)                                                  // back to doc
 *
 * What counts as one undo step:
 *   - a single `applyCommand`;
 *   - a transaction: `beginTransaction` ... any number of `applyCommand` ... `commitTransaction`. A drag is one
 *     transaction: begin on pointer down, a `frame.move` per pointer move (the document updates live), commit on
 *     pointer up. `cancelTransaction` restores the document from before the begin (Escape);
 *   - consecutive `applyCommand`s with the same `coalesceKey` and nothing in between (typing a value into a field
 *     that commits on every keystroke). Any undo, redo, begin, other command or a different key ends the run.
 *
 * Selection, viewport and active tool are not in here: they are store state outside the undo history.
 */
import { applyPatches, enablePatches, produceWithPatches, type Patch } from 'immer';
import type { CommandDef } from './commands/types';
import type { GalleyDocument } from './schema';

enablePatches();

export interface HistoryEntry {
  /** Increasing; never reused, so it identifies a document state (see `historyRevision`). */
  seq: number;
  label: string;
  patches: Patch[];
  inversePatches: Patch[];
  coalesceKey: string | null;
}

interface Transaction {
  label: string;
  baseDoc: GalleyDocument;
  patches: Patch[];
  inversePatches: Patch[];
}

export interface HistoryState {
  /** The current document. */
  readonly doc: GalleyDocument;
  /** Oldest first; the last entry is the one `undo` reverts. */
  readonly past: readonly HistoryEntry[];
  /** The entry `redo` re-applies is the last one (most recently undone). */
  readonly future: readonly HistoryEntry[];
  readonly pending: Transaction | null;
  /** Key of the entry the next `applyCommand` may merge into, or null. */
  readonly openKey: string | null;
  readonly nextSeq: number;
}

export interface ApplyOptions {
  /** Merge this change into the previous undo step when that step has the same key and nothing happened in between. */
  coalesceKey?: string;
  /** Override the command's undo label for this step. */
  label?: string;
}

export function createHistory(doc: GalleyDocument): HistoryState {
  return { doc, past: [], future: [], pending: null, openKey: null, nextSeq: 1 };
}

/**
 * Run a command on the current document. Returns the same state when the command changed nothing. Throws
 * `CommandError` (or any error the command throws) with the state unchanged. Clears the redo stack.
 */
export function applyCommand<A>(h: HistoryState, command: CommandDef<A>, args: A, options: ApplyOptions = {}): HistoryState {
  const [next, patches, inversePatches] = produceWithPatches(h.doc, (draft) => {
    command.run(draft, args);
  });
  if (patches.length === 0) return h;
  const label = options.label ?? command.label;

  if (h.pending) {
    return {
      ...h,
      doc: next,
      pending: {
        ...h.pending,
        patches: [...h.pending.patches, ...patches],
        // undo runs the newest inverse first
        inversePatches: [...inversePatches, ...h.pending.inversePatches],
      },
    };
  }

  const key = options.coalesceKey ?? null;
  const top = h.past[h.past.length - 1];
  if (key !== null && top && h.openKey === key && top.coalesceKey === key && h.future.length === 0) {
    // A merged step gets a fresh seq: the document changed, so its revision must too (dirty tracking).
    const merged: HistoryEntry = {
      ...top,
      seq: h.nextSeq,
      patches: [...top.patches, ...patches],
      inversePatches: [...inversePatches, ...top.inversePatches],
    };
    return { ...h, doc: next, past: [...h.past.slice(0, -1), merged], openKey: key, nextSeq: h.nextSeq + 1 };
  }

  const entry: HistoryEntry = { seq: h.nextSeq, label, patches, inversePatches, coalesceKey: key };
  return { ...h, doc: next, past: [...h.past, entry], future: [], openKey: key, nextSeq: h.nextSeq + 1 };
}

/** End any coalescing run: the next keyed change starts a new undo step (call it on save, blur, or focus change). */
export function closeCoalescing(h: HistoryState): HistoryState {
  return h.openKey === null ? h : { ...h, openKey: null };
}

/** Start a transaction: every change until `commitTransaction` becomes one undo step. Not nestable. */
export function beginTransaction(h: HistoryState, label: string): HistoryState {
  if (h.pending) throw new Error(`A transaction ("${h.pending.label}") is already open`);
  return { ...h, openKey: null, pending: { label, baseDoc: h.doc, patches: [], inversePatches: [] } };
}

/** End the transaction as one undo step. A transaction that changed nothing leaves no step. */
export function commitTransaction(h: HistoryState): HistoryState {
  const t = h.pending;
  if (!t) return h;
  if (t.patches.length === 0) return { ...h, pending: null };
  const entry: HistoryEntry = { seq: h.nextSeq, label: t.label, patches: t.patches, inversePatches: t.inversePatches, coalesceKey: null };
  return { ...h, pending: null, past: [...h.past, entry], future: [], openKey: null, nextSeq: h.nextSeq + 1 };
}

/** Abandon the transaction and restore the document from before it began. */
export function cancelTransaction(h: HistoryState): HistoryState {
  const t = h.pending;
  if (!t) return h;
  return { ...h, doc: t.baseDoc, pending: null };
}

export function canUndo(h: HistoryState): boolean {
  return h.pending === null && h.past.length > 0;
}
export function canRedo(h: HistoryState): boolean {
  return h.pending === null && h.future.length > 0;
}
export function undoLabel(h: HistoryState): string | null {
  return h.past.length > 0 ? h.past[h.past.length - 1]!.label : null;
}
export function redoLabel(h: HistoryState): string | null {
  return h.future.length > 0 ? h.future[h.future.length - 1]!.label : null;
}

export function undo(h: HistoryState): HistoryState {
  if (!canUndo(h)) return h;
  const entry = h.past[h.past.length - 1]!;
  const doc = applyPatches(h.doc, entry.inversePatches);
  return { ...h, doc, past: h.past.slice(0, -1), future: [...h.future, entry], openKey: null };
}

export function redo(h: HistoryState): HistoryState {
  if (!canRedo(h)) return h;
  const entry = h.future[h.future.length - 1]!;
  const doc = applyPatches(h.doc, entry.patches);
  return { ...h, doc, past: [...h.past, entry], future: h.future.slice(0, -1), openKey: null };
}

/**
 * Identifies the current document state: the `seq` of the last undo step (0 at the start). Save the value when the
 * document is saved; the document is dirty exactly when the revision differs. Undoing back to the saved state is clean again.
 */
export function historyRevision(h: HistoryState): number {
  return h.past.length > 0 ? h.past[h.past.length - 1]!.seq : 0;
}

/** Replace the document and drop all history (File > Open, revert). */
export function resetHistory(h: HistoryState, doc: GalleyDocument): HistoryState {
  return { ...createHistory(doc), nextSeq: h.nextSeq };
}
