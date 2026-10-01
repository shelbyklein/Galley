// The editor's soft-proof source (P1-07): asks the main process (LittleCMS through the output profile) for the display RGB
// of each CMYK or spot ink, caches the answers, and tells @galley/render when they arrive. Lane A.
import type { Ink, Rgb255 } from '@galley/model';
import type { SoftProofSource } from '@galley/render';
import type { ProofCmyk } from '../../shared/export-ipc';

type Bridge = (inks: ProofCmyk[]) => Promise<[number, number, number][] | null>;

/** What actually prints: each ink's CMYK at its tint (a spot color is proofed through its CMYK alternate). */
export function proofCmykOf(ink: Pick<Ink, 'values' | 'tint'>): ProofCmyk {
  return ink.values.map((v) => Math.round(((v * ink.tint) / 100) * 10000) / 10000) as ProofCmyk;
}

export interface EditorSoftProof extends SoftProofSource {
  /** False once the main process said there is no usable output profile: the page keeps its approximate colors. */
  available(): boolean;
}

export function createSoftProofSource(convert: Bridge): EditorSoftProof {
  const cache = new Map<string, Rgb255>();
  const pending = new Map<string, ProofCmyk>();
  const listeners = new Set<() => void>();
  let inflight = 0;
  let scheduled = false;
  let usable = true;

  const flush = async (): Promise<void> => {
    scheduled = false;
    const batch = [...pending.entries()];
    pending.clear();
    if (batch.length === 0) return;
    inflight++;
    try {
      const rgb = await convert(batch.map(([, cmyk]) => cmyk));
      if (rgb && rgb.length === batch.length) batch.forEach(([key], i) => cache.set(key, rgb[i]!));
      else usable = false; // no output profile (or an unexpected answer): stop asking
    } catch (error) {
      usable = false;
      console.error('Soft proofing failed; showing approximate colors', error);
    } finally {
      inflight--;
    }
    // answers first, then the notification, so a page that renders now sees both the colors and "settled"
    for (const l of [...listeners]) l();
  };

  return {
    proof(ink) {
      const cmyk = proofCmykOf(ink);
      const key = cmyk.join(',');
      const hit = cache.get(key);
      if (hit) return hit;
      if (!usable) return undefined;
      if (!pending.has(key)) pending.set(key, cmyk);
      if (!scheduled) {
        scheduled = true;
        queueMicrotask(() => void flush()); // one request for all the inks of this render
      }
      return undefined;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    isSettled: () => pending.size === 0 && inflight === 0,
    available: () => usable,
  };
}
