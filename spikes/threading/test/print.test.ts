// Print fidelity: Electron webContents.printToPDF (preferCSSPageSize, printBackground, zero margins) vs the screen.
// Lines are extracted from the PDF with `pdftotext -bbox-layout` and compared to the lines the renderer measured on
// screen (independent per-word Range rects): same words on every line, same frame breaks, same hyphens.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, pdfFonts, pdfMatch, settle, sweepFrames, type App, type PdfMatch } from './helpers';
import { pdfFonts as _f } from '../src/main/pdfcheck';

void _f;
let a: App;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g = <T = any>(name: string, ...args: any[]) => a.page.evaluate(([n, ar]) => (window as any).galley[n](...(ar as any[])), [name, args] as [string, any[]]) as Promise<T>;

const summarize = (m: PdfMatch) => `${m.domLines} lines, ${m.mismatches} mismatches, dy spread ${m.dySpread.toFixed(3)}pt, dx max ${m.dxMax.toFixed(3)}pt`;
const assertMatch = (m: PdfMatch, label: string) => {
  assert.equal(m.mismatches, 0, `${label}: ${m.details.join(' | ')}`);
  assert.ok(m.ok && m.domLines > 20, `${label}: compared ${m.domLines} lines`);
  assert.equal(m.domLines, m.pdfLines, `${label}: same number of lines`);
  assert.equal(m.pages, 1, `${label}: one page`);
  assert.ok(m.dySpread < 0.5, `${label}: vertical agreement ${m.dySpread}pt`);
  assert.ok(m.dxMax < 0.5, `${label}: horizontal agreement ${m.dxMax}pt`);
};

before(async () => {
  a = await launch();
});
after(async () => {
  await a?.close();
});

describe('printToPDF line match', () => {
  it('default page: every line of every frame matches the screen exactly (same words, same frame breaks)', async () => {
    await g('load', {});
    const m = await pdfMatch(a, 'print-default.pdf');
    console.log(`    default page: ${summarize(m)}`);
    assertMatch(m, 'default');
    assert.equal(m.width, 612);
    assert.equal(m.height, 792);
    // frame breaks specifically: the last line and first line around each join are identical
    const sl = await g<any[]>('slices');
    let joins = 0;
    sl.forEach((s, k) => {
      if (k + 1 < sl.length && s.endMid) {
        joins++;
        const lastDom = m.domLinesBySlot[k].at(-1)!.text;
        const lastPdf = m.pdfLinesBySlot[k].at(-1)!.text;
        const firstDom = m.domLinesBySlot[k + 1][0].text;
        const firstPdf = m.pdfLinesBySlot[k + 1][0].text;
        assert.equal(lastPdf, lastDom, `last line of frame ${k}`);
        assert.equal(firstPdf, firstDom, `first line of frame ${k + 1}`);
      }
    });
    assert.ok(joins >= 3);
  });

  it('fonts embed as real TrueType (static Inter), not Type 3', async () => {
    const f = pdfFonts('out/print-default.pdf'.startsWith('/') ? 'out/print-default.pdf' : new URL('../out/print-default.pdf', import.meta.url).pathname);
    assert.ok(f.length >= 3);
    for (const x of f) {
      assert.ok(x.emb, `${x.name} embedded`);
      assert.ok(/TrueType/.test(x.type) && !/Type 3/.test(x.type), `${x.name} is ${x.type}`);
    }
  });

  it('the last line of a paragraph that continues in the next frame is justified like a middle line', async () => {
    await g('load', {});
    const sl = await g<any[]>('slices');
    const lines = await g<any[][]>('lines');
    const rects = await a.page.evaluate(() => (window as any).galley.app.slots as { x: number; w: number }[]);
    let n = 0;
    sl.forEach((s, k) => {
      if (k + 1 < sl.length && s.endMid && !s.hy) {
        n++;
        const l = lines[k].at(-1);
        assert.ok(Math.abs(l.right - (rects[k].x + rects[k].w)) < 1, `frame ${k}: last line ends at the right edge (${l.right} vs ${rects[k].x + rects[k].w})`);
      }
    });
    assert.ok(n >= 3);
  });

  it('after an edit that changes the threading, PDF and screen still agree (type, undo, delete a paragraph)', async () => {
    await g('load', {});
    const before = await g<any[]>('slices');
    await g('focus');
    await g('setSelection', (await g<number>('findPos', 'Every page')) + 5, undefined, 0);
    await a.page.keyboard.type('A longer opening that wraps onto a further line of frame one and pushes the rest forward. ');
    await settle(a.page);
    const edited = await g<any[]>('slices');
    assert.notDeepEqual(edited.map((s) => [s.start, s.end]), before.map((s) => [s.start, s.end]));
    assert.ok(edited[1].start !== before[1].start + 'A longer opening that wraps onto a further line of frame one and pushes the rest forward. '.length, 'the edit changed the threading, not just shifted it');
    let m = await pdfMatch(a, 'print-edited.pdf');
    console.log(`    after typing: ${summarize(m)}`);
    assertMatch(m, 'after typing');
    await a.page.keyboard.press('Meta+z');
    await settle(a.page);
    m = await pdfMatch(a, 'print-undone.pdf');
    assertMatch(m, 'after undo');
    // delete the 2nd body paragraph: everything pulls back
    const p2 = await g<number>('findPos', 'A compositor working');
    await g('setSelection', p2, p2 + 603, 0);
    await a.page.keyboard.press('Backspace');
    await settle(a.page);
    const after = await g<any[]>('slices');
    assert.notDeepEqual(after.map((s) => [s.start, s.end]), before.map((s) => [s.start, s.end]));
    m = await pdfMatch(a, 'print-deleted.pdf');
    console.log(`    after deleting text: ${summarize(m)}`);
    assertMatch(m, 'after delete');
  });

  it('a hyphenated word at a frame break prints as "exam-" / "ple": hyphen at the end of one frame, the rest at the start of the next', async () => {
    let w = 300;
    let k = -1;
    for (; w <= 504 && k < 0; w += 3) {
      await g('load', { frames: sweepFrames(w, 249) });
      const sl = await g<any[]>('slices');
      k = sl.findIndex((s, i) => i < sl.length - 1 && s.hy);
    }
    assert.ok(k >= 0, 'found a hyphenated frame break');
    const m = await pdfMatch(a, 'print-hyphen-join.pdf');
    assertMatch(m, 'hyphen join');
    const last = m.pdfLinesBySlot[k].at(-1)!.text;
    const first = m.pdfLinesBySlot[k + 1][0].text;
    assert.ok(last.endsWith('-'), `PDF: frame ${k} ends with a hyphen: "${last}"`);
    console.log(`    PDF join: "...${last.split(' ').slice(-2).join(' ')}" | "${first.split(' ').slice(0, 2).join(' ')}..."`);
    // the hyphen is a real glyph in the PDF (U+2010), as the engine draws at in-frame breaks
    const lastWord = m.words.filter((x) => x.text.endsWith('‐') || x.text.endsWith('-'));
    assert.ok(lastWord.length >= 1);
  });

  it('34 frame geometries: PDF and screen agree on every line, including every hyphenated join', async () => {
    let configs = 0;
    let lines = 0;
    let hyJoins = 0;
    let midJoins = 0;
    for (let w1 = 300; w1 <= 504; w1 += 12) {
      for (const w2 of [150, 249]) {
        if (configs >= 34) break;
        await g('load', { frames: sweepFrames(w1, w2) });
        const sl = await g<any[]>('slices');
        sl.forEach((s, k) => {
          if (k < sl.length - 1 && s.endMid) midJoins++;
          if (k < sl.length - 1 && s.hy) hyJoins++;
        });
        const m = await pdfMatch(a, 'print-sweep.pdf');
        assert.equal(m.mismatches, 0, `w1=${w1} w2=${w2}: ${m.details.join(' | ')}`);
        assert.equal(m.pages, 1);
        lines += m.domLines;
        configs++;
      }
    }
    console.log(`    ${configs} geometries, ${lines} lines compared, ${midJoins} mid-paragraph joins, ${hyJoins} hyphenated joins, 0 mismatches`);
    assert.ok(configs >= 30 && hyJoins >= 3);
  });

  it('with hyphenation off the PDF still matches', async () => {
    await g('load', { hyphens: false });
    assertMatch(await pdfMatch(a, 'print-nohyph.pdf'), 'hyphens off');
  });

  it('text wrap: PDF lines match the screen and no printed word touches the image', async () => {
    await g('load', { page: 'wrap' });
    const m = await pdfMatch(a, 'print-wrap.pdf');
    console.log(`    wrap page: ${summarize(m)}`);
    assertMatch(m, 'wrap page');
    const ob = { x: 141, y: 345, w: 150, h: 120, offset: 6 };
    const cx = ob.x + ob.w / 2;
    const cy = ob.y + ob.h / 2;
    const rx = ob.w / 2 + ob.offset;
    const ry = ob.h / 2 + ob.offset;
    let near = 0;
    for (const w of m.words) {
      const nx = Math.min(Math.max(cx, w.x0), w.x1) - cx;
      const ny = Math.min(Math.max(cy, w.y0), w.y1) - cy;
      const d = (nx / rx) ** 2 + (ny / ry) ** 2;
      assert.ok(d >= 1 - 0.03, `PDF word "${w.text}" intrudes into the wrap area (d=${d.toFixed(3)})`);
      if (d < 1.35) near++;
    }
    assert.ok(near >= 8, `words hug the ellipse (${near} words within 35% of its boundary)`);
    // edit inside a wrapped frame and print again
    await g('focus');
    await g('setSelection', (await g<number>('findPos', 'The rules he followed')) + 5, undefined, 1);
    await a.page.keyboard.type('typing beside the image reflows around it ');
    await settle(a.page);
    assertMatch(await pdfMatch(a, 'print-wrap-edited.pdf'), 'wrap page after typing');
  });

  it('overset text and editor chrome are not printed', async () => {
    await g('load', { story: 'long', words: 2500 });
    const ov = await g('overset');
    assert.ok(ov && ov.words > 500);
    const m = await pdfMatch(a, 'print-overset.pdf');
    assertMatch(m, 'overset page');
    const inSlot = (w: { x0: number; x1: number; y0: number; y1: number }) =>
      m.slotRects.some((s) => (w.x0 + w.x1) / 2 >= s.x - 2 && (w.x0 + w.x1) / 2 <= s.x + s.w + 2 && (w.y0 + w.y1) / 2 >= s.y - 2 && (w.y0 + w.y1) / 2 <= s.y + s.h + 2);
    const stray = m.words.filter((w) => !inSlot(w));
    assert.equal(stray.length, 0, `words outside every frame: ${stray.slice(0, 5).map((w) => w.text)}`);
    assert.ok(!m.words.some((w) => /Overset/.test(w.text)), 'overset marker is chrome and is not printed');
    // the PDF holds exactly the placed text: its word count equals the placed word count
    const sl = await g<any[]>('slices');
    let placed = '';
    sl.forEach((s, k) => {
      if (!s.empty) placed += (k > 0 && !s.startMid ? '\n' : '') + s.text;
    });
    const placedWords = (placed.match(/\S+/g) ?? []).length;
    // hyphenated words appear as two PDF words; a word split at a slot join is one story word
    const hyphenSplits = m.pdfLinesBySlot.flat().filter((l) => l.text.endsWith('-') && !/\s-$/.test(l.text)).length;
    assert.ok(Math.abs(m.words.length - placedWords - hyphenSplits) <= sl.length, `pdf words ${m.words.length} vs placed ${placedWords} (+${hyphenSplits} split)`);
  });
});
