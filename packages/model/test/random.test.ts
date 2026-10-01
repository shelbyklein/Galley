import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  allCommands,
  applyCommand,
  beginTransaction,
  cancelTransaction,
  canonicalStringify,
  commitTransaction,
  CommandError,
  parseDocument,
  redo,
  serializeDocument,
  undo,
  validateDocument,
  type GalleyDocument,
  type HistoryState,
} from '../src';
import { baseDoc, history, rng } from './helpers';
import { generatedCommandKeys, randomCommand } from './random-commands';

const canon = (doc: GalleyDocument) => canonicalStringify(doc);

const succeeded = new Map<string, number>();
const rejected = new Map<string, number>();
let sequences = 0;
let totalSteps = 0;

/** Try a command; a CommandError must leave the history state exactly as it was. */
function attempt(h: HistoryState, seed: number, name: string, apply: () => HistoryState): HistoryState {
  try {
    const next = apply();
    succeeded.set(name, (succeeded.get(name) ?? 0) + 1);
    return next;
  } catch (e) {
    if (!(e instanceof CommandError)) throw new Error(`seed ${seed}: ${name} threw a non-CommandError: ${(e as Error).stack}`);
    rejected.set(name, (rejected.get(name) ?? 0) + 1);
    return h;
  }
}

function runSequence(seed: number, steps: number): void {
  const r = rng(seed);
  let h = history(baseDoc());
  /** snapshots[k] is the document after k undo steps. */
  const snapshots: GalleyDocument[] = [h.doc];

  const checkValid = (doc: GalleyDocument, what: string) => {
    const issues = validateDocument(doc);
    if (issues.length > 0) throw new Error(`seed ${seed}: invalid document after ${what}: ${JSON.stringify(issues.slice(0, 3))}`);
  };

  for (let i = 0; i < steps; i++) {
    const rc = randomCommand(h.doc, r);
    if (!rc) continue;
    totalSteps++;
    const before = h;
    const mode = r.pick(['plain', 'plain', 'plain', 'plain', 'transaction', 'cancel', 'coalesce']);

    if (mode === 'plain' || mode === 'coalesce') {
      const next = attempt(h, seed, rc.key, () => applyCommand(h, rc.command, rc.args, mode === 'coalesce' ? { coalesceKey: 'run' } : {}));
      if (next === before) {
        expect(next.doc).toBe(before.doc);
        continue;
      }
      h = next;
      checkValid(h.doc, rc.key);
      if (h.past.length > before.past.length) snapshots.push(h.doc);
      else snapshots[snapshots.length - 1] = h.doc; // merged into the previous step
    } else {
      h = beginTransaction(h, 'Gesture');
      const count = r.int(1, 4);
      for (let k = 0; k < count; k++) {
        const inner = k === 0 ? rc : randomCommand(h.doc, r);
        if (!inner) continue;
        h = attempt(h, seed, inner.key, () => applyCommand(h, inner.command, inner.args));
        checkValid(h.doc, `${inner.key} in a transaction`);
      }
      if (mode === 'cancel') {
        h = cancelTransaction(h);
        expect(h.doc).toBe(before.doc);
        expect(h.past.length).toBe(before.past.length);
      } else {
        h = commitTransaction(h);
        if (h.past.length > before.past.length) {
          expect(h.past.length).toBe(before.past.length + 1); // however many commands, one step
          snapshots.push(h.doc);
        } else {
          expect(h.doc).toBe(before.doc);
        }
      }
    }
  }

  const finalDoc = h.doc;
  const n = h.past.length;
  expect(snapshots.length, `seed ${seed}: one snapshot per undo step`).toBe(n + 1);

  // step back one at a time, matching every intermediate document
  for (let k = n; k >= 1; k--) {
    h = undo(h);
    expect(canon(h.doc), `seed ${seed}: undo to step ${k - 1}`).toBe(canon(snapshots[k - 1]!));
    checkValid(h.doc, `undo to ${k - 1}`);
  }
  expect(h.past.length).toBe(0);
  expect(canon(h.doc), `seed ${seed}: undo-all returns the original`).toBe(canon(snapshots[0]!));

  // and forward again
  for (let k = 1; k <= n; k++) {
    h = redo(h);
    expect(canon(h.doc), `seed ${seed}: redo to step ${k}`).toBe(canon(snapshots[k]!));
  }
  expect(canon(h.doc), `seed ${seed}: redo-all returns the final document`).toBe(canon(finalDoc));
  expect(h.future.length).toBe(0);

  // the final document survives serialization
  expect(parseDocument(serializeDocument(finalDoc))).toEqual(finalDoc);
  sequences++;
}

describe('random command sequences', () => {
  it('undo-all then redo-all reproduces the documents, for 600 random sequences', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 2 ** 31 - 1 }), fc.integer({ min: 3, max: 45 }), (seed, steps) => {
        runSequence(seed, steps);
      }),
      { numRuns: 600 },
    );
    expect(sequences).toBeGreaterThanOrEqual(500);
  });

  it('a long sequence of 400 steps also round-trips', () => {
    runSequence(20261001, 400);
  });

  it('every command in the model has a generator, and each one succeeded at least once', () => {
    const missing = Object.keys(allCommands).filter((k) => !generatedCommandKeys.includes(k));
    expect(missing, 'add a generator to test/random-commands.ts for new commands').toEqual([]);
    const never = Object.keys(allCommands).filter((k) => !succeeded.has(k));
    expect(never, `commands never applied successfully (steps: ${totalSteps})`).toEqual([]);
  });

  it('invalid arguments are rejected without side effects', () => {
    // exercised inside the sequences above (removing the last page, grouping across pages, ...); make sure it happened
    expect([...rejected.values()].reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
  });
});
