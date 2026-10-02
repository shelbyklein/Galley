import type { Ink } from '@galley/model';
import { describe, expect, it } from 'vitest';
import { createSoftProofSource, proofCmykOf } from './softproof';

const ink = (values: [number, number, number, number], tint = 100): Ink => ({ swatchId: 'x', name: 'x', model: 'cmyk', overprint: false, values, tint });
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('proofCmykOf', () => {
  it('is the ink at its tint: what actually prints', () => {
    expect(proofCmykOf(ink([0, 60, 100, 0], 50))).toEqual([0, 30, 50, 0]);
    expect(proofCmykOf(ink([0, 91, 76, 0], 40))).toEqual([0, 36.4, 30.4, 0]);
  });
});

describe('the editor soft-proof source', () => {
  it('batches the inks of one render into one request, answers from the cache afterwards, and notifies when answers arrive', async () => {
    const requests: number[][][] = [];
    const source = createSoftProofSource(async (inks) => {
      requests.push(inks);
      return inks.map((c) => [c[0], c[1], c[2]] as [number, number, number]);
    });
    let notified = 0;
    source.subscribe(() => notified++);

    // first render: nothing known yet, nothing settled, and every ink is asked for exactly once
    expect(source.proof(ink([0, 60, 100, 0]))).toBeUndefined();
    expect(source.proof(ink([100, 0, 0, 0]))).toBeUndefined();
    expect(source.proof(ink([0, 60, 100, 0]))).toBeUndefined();
    expect(source.isSettled()).toBe(false);
    await tick();
    expect(requests).toEqual([[[0, 60, 100, 0], [100, 0, 0, 0]]]);
    expect(notified).toBe(1);
    expect(source.isSettled()).toBe(true);

    // later renders are answered synchronously from the cache and ask for nothing
    expect(source.proof(ink([0, 60, 100, 0]))).toEqual([0, 60, 100]);
    expect(source.proof(ink([0, 120, 200, 0], 50))).toEqual([0, 60, 100]); // same printed ink: same key
    await tick();
    expect(requests).toHaveLength(1);
  });

  it('gives up, once, when the main process has no profile, and says so', async () => {
    let asked = 0;
    const source = createSoftProofSource(async () => {
      asked++;
      return null;
    });
    expect(source.available()).toBe(true);
    source.proof(ink([1, 2, 3, 4]));
    await tick();
    expect(source.available()).toBe(false);
    expect(source.isSettled()).toBe(true);
    expect(source.proof(ink([5, 6, 7, 8]))).toBeUndefined();
    await tick();
    expect(asked).toBe(1); // no more requests
  });

  it('survives a failing request: approximate colors, settled, no unhandled rejection', async () => {
    const original = console.error;
    console.error = () => undefined;
    try {
      const source = createSoftProofSource(async () => {
        throw new Error('ipc closed');
      });
      source.proof(ink([1, 2, 3, 4]));
      await tick();
      expect(source.available()).toBe(false);
      expect(source.isSettled()).toBe(true);
    } finally {
      console.error = original;
    }
  });
});
