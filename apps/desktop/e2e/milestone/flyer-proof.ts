import { expect, type Page } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { APP_DIR, REPO_ROOT } from '../helpers/launch';
import { waitForStable } from '../helpers/screenshot';
import { flushInput } from '../canvas/helpers';
import { TOOL_ENV } from './helpers';

export const FLYER_SHOTS = path.join(APP_DIR, 'test-results', 'milestone2');

export async function flyerShot(page: Page, name: string): Promise<void> {
  await waitForStable(page);
  await page.mouse.move(2, 2);
  await flushInput(page);
  fs.mkdirSync(FLYER_SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(FLYER_SHOTS, `${name}.png`), scale: 'css', animations: 'disabled', caret: 'hide' });
}

/** Word Ranges inspect the painted DOM independently of the thread engine, in coordinates relative to the page trim. */
export async function captureFlyerLines(page: Page, ids: string[]) {
  await waitForStable(page);
  return page.evaluate(frameIds => {
    const state = (window as any).__galley.store.getState();
    const doc = state.history.doc;
    const { zoom, panX, panY } = state.viewport;
    const viewport = document.querySelector('[data-testid="canvas-viewport"]')!.getBoundingClientRect();
    const origin = { x: viewport.left + panX, y: viewport.top + panY };
    return frameIds.map(id => {
      const frame = doc.frames[id];
      const root = document.querySelector(`.galley-text[data-frame-id="${id}"]`);
      if (!root) throw new Error(`No rendered text frame ${id}`);
      const lines: { text: string; cy: number; baseline: number; left: number; right: number }[] = [];
      for (const para of root.querySelectorAll('p')) {
        const walker = document.createTreeWalker(para, NodeFilter.SHOW_TEXT);
        const nodes: { node: Text; start: number }[] = [];
        let text = '';
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          nodes.push({ node: node as Text, start: text.length });
          text += node.textContent ?? '';
        }
        const location = (offset: number, end: boolean) => {
          const entry = [...nodes].reverse().find(n => end ? offset > n.start : offset >= n.start);
          if (!entry) throw new Error('Missing word location');
          return { node: entry.node, offset: offset - entry.start };
        };
        const words: { text: string; cy: number; left: number; right: number; range: Range }[] = [];
        for (const match of text.matchAll(/\S+/g)) {
          const begin = location(match.index, false), end = location(match.index + match[0].length, true);
          const range = document.createRange();
          range.setStart(begin.node, begin.offset);
          range.setEnd(end.node, end.offset);
          const rects = [...range.getClientRects()].filter(r => r.width > 0 && r.height > 0);
          if (!rects.length) continue;
          const centers = rects.map(r => (r.top + r.bottom) / 2);
          if (Math.max(...centers) - Math.min(...centers) > zoom * 3) throw new Error('Flyer words must be unhyphenated for this independent checker');
          const cy = (centers[0]! - origin.y) / zoom;
          if (cy < frame.y || cy > frame.y + frame.h) continue;
          words.push({ text: match[0], cy, range, left: (Math.min(...rects.map(r => r.left)) - origin.x) / zoom,
            right: (Math.max(...rects.map(r => r.right)) - origin.x) / zoom });
        }
        const groups: typeof words[] = [];
        for (const word of words) {
          const group = groups.at(-1);
          if (group && Math.abs(group[0]!.cy - word.cy) < 3) group.push(word);
          else groups.push([word]);
        }
        for (const group of groups) {
          group.sort((a, b) => a.left - b.left);
          // An empty inline block's bottom sits on the real text baseline. Put it after the first word so it cannot
          // occupy the preceding line while that word wraps. Live Ranges survive text-node splitting and merging.
          const before = group[0]!.range.getBoundingClientRect();
          const marker = document.createElement('span');
          marker.style.cssText = 'display:inline-block;width:0;height:0;padding:0;margin:0;border:0;vertical-align:baseline';
          const at = group[0]!.range.cloneRange(); at.collapse(false); at.insertNode(marker);
          const during = group[0]!.range.getBoundingClientRect();
          if (Math.max(Math.abs(during.top - before.top), Math.abs(during.left - before.left)) > 0.01) throw new Error('Baseline probe changed live text geometry');
          const baseline = (marker.getBoundingClientRect().bottom - origin.y) / zoom;
          marker.remove(); para.normalize();
          const after = group[0]!.range.getBoundingClientRect();
          if (Math.max(Math.abs(after.top - before.top), Math.abs(after.left - before.left)) > 0.01) throw new Error('Baseline probe changed text geometry');
          lines.push({ text: group.map(w => w.text).join(' '), cy: group.reduce((sum, w) => sum + w.cy, 0) / group.length, baseline,
            left: Math.min(...group.map(w => w.left)), right: Math.max(...group.map(w => w.right)) });
        }
      }
      return { id, x: frame.x, y: frame.y, w: frame.w, h: frame.h, lines };
    });
  }, ids);
}

export function checkFlyer(pdf: string, pkg: string, screen: string, work: string) {
  const r = spawnSync(path.join(REPO_ROOT, 'node_modules/.bin/tsx'), [path.join(REPO_ROOT, 'scripts/milestone2/check-flyer.ts'), pdf, pkg, screen, work],
    { encoding: 'utf8', env: TOOL_ENV, maxBuffer: 128 << 20 });
  const result = JSON.parse(r.stdout.trim().split('\n').at(-1) || '{}');
  expect(r.status, `${r.stderr}\n${JSON.stringify(result, null, 2)}`).toBe(0);
  expect(result.checks?.length).toBeGreaterThan(15);
  expect(result.checks.filter((c: { pass: boolean }) => !c.pass)).toEqual([]);
  return result;
}
