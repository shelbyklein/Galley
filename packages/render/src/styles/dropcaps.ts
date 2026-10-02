import type { PMNode, ResolvedParagraph } from '@galley/model';
import type { CSSProperties } from 'react';
import { pt } from '../geometry';

/** Split at Unicode codepoints, preserving every run's marks and never splitting a surrogate pair. */
export function splitDropCapRuns(runs: readonly PMNode[], count: number): { initial: PMNode[]; rest: PMNode[] } {
  const initial: PMNode[] = [], rest: PMNode[] = [];
  let remaining = count;
  for (const run of runs) {
    const chars = Array.from(run.text ?? '');
    const taken = Math.min(remaining, chars.length);
    if (taken) initial.push({ ...run, text: chars.slice(0, taken).join('') });
    if (taken < chars.length) rest.push({ ...run, text: chars.slice(taken).join('') });
    remaining -= taken;
  }
  return { initial, rest };
}
/**
 * Chromium only sizes single-letter initials natively. Multi-character initials use a first-child float with an explicit
 * N-line exclusion box. Both screen and print use this same box; no breaks or composition decisions are inserted.
 * One ordinary em plus (N-1) leadings gives a readable multi-letter initial; the exclusion depth is exactly N leadings.
 */
export function dropCapCss(r: ResolvedParagraph): CSSProperties {
  if (r.dropCapLines <= 0 || r.dropCapChars <= 1) return {};
  return { float: 'left', fontSize: pt(r.fontSize + (r.dropCapLines - 1) * r.leading), lineHeight: pt(r.dropCapLines * r.leading), height: pt(r.dropCapLines * r.leading), marginRight: '0.15em', whiteSpace: 'pre' };
}

/** Measured DOM helper. The editor uses an inline decoration over the same initial range; never mutate its contentDOM. */
export function applyDropCapDOM(p: HTMLElement, r: ResolvedParagraph): void {
  if (r.dropCapLines <= 0 || r.dropCapChars <= 1 || p.querySelector('[data-drop-cap]')) return;
  const doc = p.ownerDocument;
  const walker = doc.createTreeWalker(p, 4 /* SHOW_TEXT */);
  let remaining = r.dropCapChars;
  let first: Text | null = null, last: Text | null = null, end = 0;
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    if (!node.data) continue;
    first ??= node;
    const points = Array.from(node.data);
    const taken = Math.min(points.length, remaining);
    last = node; end = points.slice(0, taken).join('').length; remaining -= taken;
    if (!remaining) break;
  }
  if (!first || !last) return;
  const range = doc.createRange(); range.setStart(first, 0); range.setEnd(last, end);
  const cap = doc.createElement('span'); cap.dataset.dropCap = String(r.dropCapChars);
  Object.assign(cap.style, dropCapCss(r));
  cap.append(range.extractContents()); range.insertNode(cap);
  for (const child of cap.querySelectorAll<HTMLElement>('[style]')) {
    child.style.removeProperty('font-size'); child.style.removeProperty('line-height'); child.style.removeProperty('position'); child.style.removeProperty('top');
  }
}
