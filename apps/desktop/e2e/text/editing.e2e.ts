// Editing scenarios driven with real keyboard / mouse / IME input through Playwright's Electron support.
import { test } from '../helpers/fixtures';
import { editorCall } from './editor-api';
import assert from 'node:assert/strict';
import { posToOffset,settle,sweepFrames } from './helpers';
import type { GalleyApp } from '../helpers/launch';

let a: GalleyApp;
test.use({open:null});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g = <T=any>(name:string,...args:any[])=>editorCall<T>(a.page,name,...args);
const kb = () => a.page.keyboard;
const place = async (pos: number, slot?: number) => {
  await g('focus');
  await g('setSelection', pos, pos, slot);
  await settle(a.page, 10);
};
const read = async () => {
  await settle(a.page);
  return { text: await g<string>('storyText'), sel: await g('selection'), slices: await g('slices'), caret: await g('caret') };
};
const insertInto = (orig: string, paras: string[], pos: number, text: string) => {
  const o = posToOffset(paras, pos);
  return orig.slice(0, o) + text + orig.slice(o);
};
const ranges = (sl: any[]) => sl.map((s) => [s.start, s.end, s.startMid, s.endMid]);

/** Load a geometry in which some non-last frame ends exactly at the end of a paragraph (the default page has none). */
async function loadParagraphBreakConfig() {
  for (let h = 120; h <= 216; h += 3) {
    const frames = sweepFrames(504, 249, h);
    await g('load', frames.length ? { frames } : {});
    const sl: any[] = await g('slices');
    const k = sl.findIndex((s, i) => i > 0 && i < sl.length - 1 && !s.endMid && !s.empty && !sl[i + 1].startMid && !sl[i + 1].empty);
    if (k >= 0) {
      orig = await g('storyText');
      origParas = await g('storyParas');
      origSlices = sl;
      return k;
    }
  }
  throw new Error('no geometry with a paragraph-aligned frame break found');
}

let orig: string;
let origParas: string[];
let origSlices: any[];

test.beforeEach(async ({galley}) => {
  a=galley;
  await g('load', {});
  await settle(a.page, 20);
  orig = await g('storyText');
  origParas = await g('storyParas');
  origSlices = await g('slices');
});

test.describe('typing', () => {
  test('typing in the middle of frame 1 edits the story at the caret and the caret stays put', async () => {
    const pos = (await g<number>('findPos', 'Every page')) + 5;
    await place(pos);
    await kb().type('XYZ');
    let r = await read();
    assert.equal(r.text, insertInto(orig, origParas, pos, 'XYZ'));
    assert.equal(r.sel.head, pos + 3);
    assert.equal(r.caret.slot, 0);
    // keep typing: the characters must land contiguously after the caret
    await kb().type(' and more words');
    r = await read();
    assert.equal(r.text, insertInto(orig, origParas, pos, 'XYZ and more words'));
    assert.equal(r.sel.head, pos + 'XYZ and more words'.length);
    assert.deepEqual(await g('invariants'), []);
    assert.deepEqual(await g('checkIncremental'), []);
  });

  test('text typed at the end of a frame pushes forward into later frames, and Backspace pulls it back (exact round trip)', async () => {
    const end0 = origSlices[0].end;
    await place(end0, 0);
    const typed = 'Pushing forward: the quick brown fox jumps over the lazy dog, again and again. '.repeat(2);
    await kb().type(typed);
    let r = await read();
    assert.equal(r.text, insertInto(orig, origParas, end0, typed), 'story text');
    assert.equal(r.sel.head, end0 + typed.length, 'caret after the typed text');
    assert.ok(r.slices[1].start >= end0, 'frame 2 now starts later in the story');
    assert.notEqual(r.slices[2].start, origSlices[2].start + typed.length, 'text was pushed out of frame 2 into frame 3: the push cascaded');
    assert.ok(r.caret.slot >= 1, `caret followed the text into a later frame (slot ${r.caret.slot})`);
    assert.deepEqual(await g('invariants'), []);
    for (let i = 0; i < typed.length; i++) await kb().press('Backspace');
    r = await read();
    assert.equal(r.text, orig, 'story restored');
    assert.deepEqual(ranges(r.slices), ranges(origSlices), 'slot boundaries restored exactly');
    assert.deepEqual(await g('invariants'), []);
  });

  test('forward Delete in the middle of a frame pulls text back from the next frame', async () => {
    const pos = origSlices[0].end - 40;
    await place(pos, 0);
    for (let i = 0; i < 60; i++) await kb().press('Delete');
    const r = await read();
    const o = posToOffset(origParas, pos);
    assert.equal(r.text, orig.slice(0, o) + orig.slice(o + 60));
    assert.ok(r.slices[0].end >= origSlices[0].end - 40, 'frame 1 refilled from frame 2');
    assert.ok(r.slices[1].start > origSlices[1].start - 60 && r.slices[2].start < origSlices[2].start, 'later frames start earlier');
    assert.deepEqual(await g('invariants'), []);
  });

  test('typing at the very end of the last frame spills into overset, with an updating count', async () => {
    const last = origSlices[origSlices.length - 1].end;
    await place(last, origSlices.length - 1);
    const spill = 'Overflowing the final frame with plenty of extra words so the story no longer fits. '.repeat(10);
    await kb().type(spill);
    const r = await read();
    const ov = await g('overset');
    assert.ok(ov && ov.words >= 20, `overset ${JSON.stringify(ov)}`);
    assert.equal((await g('oversetUi')).text, `${ov.words} overset words`);
    assert.deepEqual(await g('invariants'), []);
    assert.ok(r.text.endsWith(spill));
  });
});

test.describe('caret movement across frame boundaries', () => {
  test('ArrowRight / ArrowLeft cross a thread join one story position per key press', async () => {
    const e = origSlices[0].end; // join between slot 0 and 1 (mid-paragraph)
    await place(e - 2, 0);
    const press = async (key: string, n: number) => {
      const out: { head: number; slot: number }[] = [];
      for (let i = 0; i < n; i++) {
        await kb().press(key);
        await settle(a.page, 15);
        out.push({ head: (await g('selection')).head, slot: (await g('caret')).slot });
      }
      return out;
    };
    const right = await press('ArrowRight', 5);
    assert.deepEqual(right.map((s) => s.head), [e - 1, e, e + 1, e + 2, e + 3], 'one story position per key, no dead key press at the join');
    assert.deepEqual(right.map((s) => s.slot), [0, 0, 1, 1, 1], 'caret moves into frame 2 after crossing');
    const left = await press('ArrowLeft', 5);
    assert.deepEqual(left.map((s) => s.head), [e + 2, e + 1, e, e - 1, e - 2]);
    assert.deepEqual(left.map((s) => s.slot), [1, 1, 1, 0, 0], 'and back into frame 1');
  });

  test('ArrowRight crosses a paragraph boundary that coincides with a frame boundary', async () => {
    const k = await loadParagraphBreakConfig();
    await place(origSlices[k].end, k);
    await kb().press('ArrowRight');
    const r = await read();
    assert.equal(r.sel.head, origSlices[k + 1].start, 'caret at the start of the next paragraph, in the next frame');
    assert.equal(r.caret.slot, k + 1);
  });

  test('ArrowDown from the last line of a frame lands in the next frame; ArrowUp comes back', async () => {
    await place(origSlices[0].end - 5, 0);
    await kb().press('ArrowDown');
    let r = await read();
    assert.equal(r.caret.slot, 1, 'ArrowDown crossed into frame 2');
    await kb().press('ArrowUp');
    r = await read();
    assert.equal(r.caret.slot, 0, 'ArrowUp came back to frame 1');
  });

  test('holding ArrowDown walks every line of every frame in chain order without stalling; ArrowUp walks back', async () => {
    // Regression for a Chromium bug: with hyphens:auto, ArrowDown does nothing when the caret sits at a generated
    // hyphenation break. The editor works around it (see watchVertical in editor.ts).
    const lines = (await g<any[][]>('lines')).flat().length;
    const end = origSlices[origSlices.length - 1].end;
    const walk = async (key: string, startPos: number, startSlot: number, until: (head: number) => boolean) => {
      await place(startPos, startSlot);
      const seen: { slot: number; head: number; y: number }[] = [];
      for (let i = 0; i < lines + 10; i++) {
        await kb().press(key);
        await settle(a.page, 8);
        const c = await g('caret');
        seen.push({ slot: c.slot, head: (await g('selection')).head, y: Math.round(c.y) });
        if (until(seen[seen.length - 1].head)) break;
      }
      return seen;
    };
    const down = await walk('ArrowDown', 2, 0, (h) => h >= end);
    assert.equal(down[down.length - 1].head, end, 'reached the end of the story');
    assert.ok(down.length <= lines + 2, `took ${down.length} presses for ${lines} lines: no stalls`);
    assert.deepEqual([...new Set(down.map((d) => d.slot))].sort(), [0, 1, 2, 3, 4], 'visited every frame');
    for (let i = 1; i < down.length; i++) assert.ok(down[i].head > down[i - 1].head, `every press moves forward (${down[i - 1].head} -> ${down[i].head} at press ${i})`);
    const up = await walk('ArrowUp', end, 4, (h) => h <= 2);
    assert.ok(up[up.length - 1].head <= 2, 'reached the top of the story');
    assert.ok(up.length <= lines + 2, `${up.length} presses up for ${lines} lines`);
    for (let i = 1; i < up.length; i++) assert.ok(up[i].head < up[i - 1].head, `every press moves backward (${up[i - 1].head} -> ${up[i].head})`);
  });
});

test.describe('Enter, Backspace and Delete at a frame boundary', () => {
  test('Enter at a join splits the paragraph there (continuation text starts the new paragraph); undo restores', async () => {
    const e = origSlices[0].end;
    await place(e, 0);
    await kb().press('Enter');
    let r = await read();
    const o = posToOffset(origParas, e);
    assert.equal(r.text, orig.slice(0, o) + '\n' + orig.slice(o));
    assert.equal((await g<string[]>('storyParas')).length, origParas.length + 1);
    assert.ok(r.slices[1].start > e && !r.slices[1].startMid, 'frame 2 now begins with a fresh paragraph');
    assert.deepEqual(await g('invariants'), []);
    await kb().press('Meta+z');
    r = await read();
    assert.equal(r.text, orig);
    assert.deepEqual(ranges(r.slices), ranges(origSlices));
    assert.deepEqual(await g('invariants'), []);
  });

  test('Backspace at the start of a continued frame deletes the character before the join', async () => {
    const e = origSlices[1].start;
    await place(e, 1);
    await kb().press('Backspace');
    const r = await read();
    const o = posToOffset(origParas, e);
    assert.equal(r.text, orig.slice(0, o - 1) + orig.slice(o));
    assert.equal(r.sel.head, e - 1);
    assert.deepEqual(await g('invariants'), []);
  });

  test('Backspace at the start of a frame that begins a paragraph merges it into the previous paragraph', async () => {
    const k = (await loadParagraphBreakConfig()) + 1; // first frame after the paragraph-aligned break
    const e = origSlices[k].start;
    await place(e, k);
    await kb().press('Backspace');
    const r = await read();
    assert.equal((await g<string[]>('storyParas')).length, origParas.length - 1);
    const o = posToOffset(origParas, e);
    assert.equal(r.text, orig.slice(0, o - 1) + orig.slice(o), 'the paragraph break is gone, nothing else changed');
    assert.deepEqual(await g('invariants'), []);
    await kb().press('Meta+z');
    assert.equal((await read()).text, orig);
  });

  test('Delete at the end of a frame deletes the next character; at a paragraph end it merges the next paragraph', async () => {
    await place(origSlices[0].end, 0);
    await kb().press('Delete');
    let r = await read();
    const o = posToOffset(origParas, origSlices[0].end);
    assert.equal(r.text, orig.slice(0, o) + orig.slice(o + 1));
    assert.deepEqual(await g('invariants'), []);
    const k = await loadParagraphBreakConfig();
    await place(origSlices[k].end, k);
    await kb().press('Delete');
    r = await read();
    assert.equal((await g<string[]>('storyParas')).length, origParas.length - 1);
    const o2 = posToOffset(origParas, origSlices[k].end);
    assert.equal(r.text, orig.slice(0, o2) + orig.slice(o2 + 1));
    assert.deepEqual(await g('invariants'), []);
  });
});

test.describe('undo / redo', () => {
  test('undo and redo walk back and forth through typing, Enter, boundary Backspace and style changes', async () => {
    const snaps: { text: string; r: any }[] = [];
    const snap = async () => {
      const r = await read();
      snaps.push({ text: r.text, r: ranges(r.slices) });
    };
    await snap();
    const step = async (fn: () => Promise<void>) => {
      await a.page.waitForTimeout(560); // > history newGroupDelay so each step is its own undo event
      await fn();
      await snap();
    };
    await step(async () => {
      await place((await g<number>('findPos', 'Every page')) + 5, 0);
      await kb().type('INSERTED');
    });
    await step(async () => kb().press('Enter'));
    await step(async () => {
      await place(origSlices[1].start + 30, 1);
      await kb().type('second edit ');
    });
    await step(async () => {
      const s = (await g<any[]>('slices'))[2].start;
      await place(s, 2);
      await kb().press('Backspace');
    });
    await step(async () => {
      await place(5, 0);
      await a.page.evaluate(() => {const g=(window as any).__galley,e=(window as any).__galleyText.editor,p=e.story.selection.$from.index(0);g.store.getState().dispatch(g.model.applyParagraphStyle,{storyId:'s0',range:{from:{paragraph:p,offset:0},to:{paragraph:p,offset:0}},styleId:'subhead'});});
    });
    assert.ok(snaps.length === 6);
    assert.deepEqual(await g('invariants'), []);
    for (let i = snaps.length - 2; i >= 0; i--) {
      await kb().press('Meta+z');
      const r = await read();
      assert.equal(r.text, snaps[i].text, `after undo to state ${i}`);
      assert.deepEqual(ranges(r.slices), snaps[i].r, `slot boundaries after undo to state ${i}`);
    }
    assert.equal((await read()).text, orig);
    for (let i = 1; i < snaps.length; i++) {
      await kb().press('Meta+Shift+z');
      const r = await read();
      assert.equal(r.text, snaps[i].text, `after redo to state ${i}`);
      assert.deepEqual(ranges(r.slices), snaps[i].r);
    }
    assert.deepEqual(await g('invariants'), []);
    assert.deepEqual(await g('checkIncremental'), []);
  });
});

test.describe('selection across frames', () => {
  test('Shift+Arrow selects across a frame boundary; typing replaces it; undo restores', async () => {
    const pos = origSlices[0].end - 30;
    await place(pos, 0);
    await kb().press('Shift+ArrowDown');
    await kb().press('Shift+ArrowDown');
    await settle(a.page);
    const sel = await g('selection');
    const lo = Math.min(sel.anchor, sel.head);
    const hi = Math.max(sel.anchor, sel.head);
    assert.ok(lo < origSlices[0].end && hi > origSlices[1].start, 'selection spans frames 1 and 2');
    const selected = await g<string>('selectionText');
    assert.ok(selected.length > 60);
    await kb().type('Q');
    let r = await read();
    const o1 = posToOffset(origParas, lo);
    const o2 = posToOffset(origParas, hi);
    assert.equal(r.text, orig.slice(0, o1) + 'Q' + orig.slice(o2));
    assert.deepEqual(await g('invariants'), []);
    await kb().press('Meta+z');
    r = await read();
    assert.equal(r.text, orig);
  });

  test('mouse: click in frame 1 and shift-click in frame 3 selects the text between; Backspace deletes it', async () => {
    const c1 = await g('coordsAt', origSlices[0].start + 120, 0);
    const c2 = await g('coordsAt', origSlices[2].start + 200, 2);
    await a.page.mouse.click(c1.x + 1, (c1.top + c1.bottom) / 2);
    await a.page.keyboard.down('Shift');
    await a.page.mouse.click(c2.x + 1, (c2.top + c2.bottom) / 2);
    await a.page.keyboard.up('Shift');
    await settle(a.page);
    const sel = await g('selection');
    const lo = Math.min(sel.anchor, sel.head);
    const hi = Math.max(sel.anchor, sel.head);
    assert.ok(Math.abs(lo - (origSlices[0].start + 120)) <= 2, `anchor ${lo}`);
    assert.ok(Math.abs(hi - (origSlices[2].start + 200)) <= 2, `head ${hi}`);
    await kb().press('Backspace');
    const r = await read();
    const o1 = posToOffset(origParas, lo);
    const o2 = posToOffset(origParas, hi);
    assert.equal(r.text, orig.slice(0, o1) + orig.slice(o2));
    assert.equal(r.sel.head, lo);
    assert.deepEqual(await g('invariants'), []);
    assert.deepEqual(await g('checkIncremental'), []);
  });

  test('Cmd+B over a cross-frame selection bolds exactly that text', async () => {
    const from = origSlices[0].end - 30;
    const to = origSlices[1].start + 40;
    await place(from, 0);
    await g('setSelection', from, to, 0);
    await kb().press('Meta+b');
    await settle(a.page);
    const m = await g<{ text: string; marks: string[];weight:number }[]>('marksAt', from, to);
    assert.ok(m.length >= 1 && m.every((x) => x.weight===700 && x.marks.includes('override')),JSON.stringify(m));
    assert.equal(m.map((x) => x.text).join(''), (await g<string>('storyText')).slice(posToOffset(origParas, from), posToOffset(origParas, to)));
    assert.deepEqual(await g('invariants'), []);
    assert.deepEqual(await g('checkIncremental'), []);
  });

  test('cut and paste work across frames (plain text; pasted paragraph breaks become paragraphs)', async () => {
    const from = origSlices[0].end - 30;
    const to = origSlices[1].start + 40;
    await g('setSelection', from, to, 0);
    const cutText = await a.page.evaluate(() => {
      const dt = new DataTransfer();
      (document.querySelector('[data-testid="text-editor"]') as HTMLElement).dispatchEvent(new ClipboardEvent('cut', { clipboardData: dt, bubbles: true, cancelable: true }));
      return dt.getData('text/plain');
    });
    assert.equal(cutText, orig.slice(posToOffset(origParas, from), posToOffset(origParas, to)));
    let r = await read();
    assert.equal(r.text, orig.slice(0, posToOffset(origParas, from)) + orig.slice(posToOffset(origParas, to)));
    await g('setSelection', 2, 2, 0);
    await a.page.evaluate(() => {
      const dt = new DataTransfer();
      dt.setData('text/plain', 'First pasted line\nSecond pasted line');
      (document.querySelector('[data-testid="text-editor"]') as HTMLElement).dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    });
    r = await read();
    const paras = await g<string[]>('storyParas');
    assert.equal(paras[0], 'SFirst pasted line', 'first pasted line joins the paragraph at the caret');
    assert.ok(paras[1].startsWith('Second pasted lineetting Type'), 'paste split the paragraph: the second line carries the rest');
    assert.deepEqual(await g('invariants'), []);
  });
});

test.describe('IME and dead keys (CDP Input.imeSetComposition)', () => {
  const cdp = async () => a.page.context().newCDPSession(a.page);

  test('dead key: option-e then e produces é in the story, as one composition and one undo step', async () => {
    const c = await cdp();
    const pos = (await g<number>('findPos', 'Every page')) + 5;
    await place(pos, 0);
    await a.page.evaluate(() => {
      (window as any).__ev = [];
      for (const t of ['compositionstart', 'compositionupdate', 'compositionend']) document.addEventListener(t, (e: any) => (window as any).__ev.push(t + ':' + e.data));
    });
    await c.send('Input.imeSetComposition', { text: '´', selectionStart: 1, selectionEnd: 1 });
    await c.send('Input.insertText', { text: 'é' });
    await settle(a.page, 120);
    const r = await read();
    assert.equal(r.text, insertInto(orig, origParas, pos, 'é'));
    assert.equal(r.sel.head, pos + 1);
    const ev: string[] = await a.page.evaluate(() => (window as any).__ev);
    assert.equal(ev.filter((x) => x.startsWith('compositionstart')).length, 1);
    assert.deepEqual(await g('invariants'), []);
    await kb().press('Meta+z');
    assert.equal((await read()).text, orig);
  });

  test('multi-step composition (CJK style) at the end of a full line keeps ONE composition session while text reflows', async () => {
    const c = await cdp();
    const e = origSlices[0].end;
    await place(e, 0);
    await a.page.evaluate(() => {
      (window as any).__ev = [];
      for (const t of ['compositionstart', 'compositionend']) document.addEventListener(t, () => (window as any).__ev.push(t));
    });
    for (const [t, caret] of [['に', 1], ['にほ', 2], ['日本', 2]] as const) {
      await c.send('Input.imeSetComposition', { text: t, selectionStart: caret, selectionEnd: caret });
      assert.equal(await a.page.evaluate(()=>{const g=(window as any).__galley;return g.model.storyPlainText(g.store.getState().history.doc.stories.s0.doc);}),orig,'preedit does not enter the stored story or static renderer');
    }
    await c.send('Input.insertText', { text: '日本' });
    await settle(a.page, 200);
    const r = await read();
    assert.equal(r.text, insertInto(orig, origParas, e, '日本'), 'only the committed text is in the story, no stale preedit text');
    const ev: string[] = await a.page.evaluate(() => (window as any).__ev);
    assert.equal(ev.filter((x) => x === 'compositionstart').length, 1, 'the IME session survived: exactly one compositionstart');
    assert.equal(ev.filter((x) => x === 'compositionend').length, 1, '...and one compositionend');
    assert.equal(await g('composing'), false);
    assert.deepEqual(await g('invariants'), [], 'after the composition ends the frames are re-threaded and consistent');
    assert.deepEqual(await g('checkIncremental'), []);
    await kb().press('Meta+z');
    assert.equal((await read()).text, orig);
  });

  test('plain text inserted via Input.insertText (no composition) behaves like typing', async () => {
    const c = await cdp();
    const pos = (await g<number>('findPos', 'Every page')) + 5;
    await place(pos, 0);
    await c.send('Input.insertText', { text: 'naïve café' });
    await settle(a.page, 60);
    assert.equal((await read()).text, insertInto(orig, origParas, pos, 'naïve café'));
    assert.deepEqual(await g('invariants'), []);
  });
});
