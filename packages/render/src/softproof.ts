/**
 * The default soft-proof source for screen mode (P1-07).
 *
 * `PageView` in screen mode shows each CMYK or spot ink as the sRGB it would print as through the output profile. The
 * conversion is done by the application (the Electron main process, with LittleCMS) and arrives asynchronously, but
 * `SoftProofFn` is synchronous, so the application installs a *source* here: `proof(ink)` answers from a cache (or
 * returns undefined and starts fetching, and the page shows the temporary conversion until the answer arrives),
 * `subscribe` tells every mounted `PageView` to repaint when answers arrive, and `isSettled` lets a page hold back
 * `data-ready` until its colors are final (screenshots and tests wait for it).
 *
 * `PageView` uses this source unless it is given its own `softProof` or `resolver`. Nothing here depends on Electron.
 */
import type { SoftProofFn } from './color';

export interface SoftProofSource {
  /** The proofed display RGB of an ink, or undefined while it is unknown (it may start fetching). */
  proof: SoftProofFn;
  /** Called when answers have arrived and colors may have changed. Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
  /** True when nothing is being fetched, so every color `proof` returned is final. */
  isSettled(): boolean;
}

let source: SoftProofSource | null = null;
let unsubscribeSource: (() => void) | null = null;
let epoch = 0;
const listeners = new Set<() => void>();

function bump(): void {
  epoch++;
  for (const l of [...listeners]) l();
}

/** Install the application's soft-proof source (or null to go back to the temporary conversion). */
export function setSoftProofSource(next: SoftProofSource | null): void {
  unsubscribeSource?.();
  unsubscribeSource = null;
  source = next;
  if (next) unsubscribeSource = next.subscribe(bump);
  bump();
}

export function getSoftProofSource(): SoftProofSource | null {
  return source;
}

/** The source as a plain `SoftProofFn`, stable across renders; it reads whichever source is installed when called. */
export const defaultSoftProof: SoftProofFn = (ink) => source?.proof(ink);

/** For `useSyncExternalStore`: changes whenever the installed source changes or reports new answers. */
export function subscribeSoftProof(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSoftProofEpoch(): number {
  return epoch;
}
