// Correctness of the threading engine: splits at the right line, nothing lost or duplicated, greedy fill,
// continuation styling, hyphenation across a frame break, overset, incremental == from-scratch.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, sweepFrames, type App } from './helpers';
import { BASE_COPY, buildLongCopy } from '../src/shared/story';

let a: App;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g = <T = any>(name: string, ...args: any[]) => a.page.evaluate(([n, ar]) => (window as any).galley[n](...(ar as any[])), [name, args] as [string, any[]]) as Promise<T>;

before(async () => {
  a = await launch();
});
after(async () => {
  await a?.close();
});

describe('default page: 3 linked frames + a 2-column frame', () => {
  before(() => g('load', {}));

  it('threads the whole ~800-word story with nothing overset and every invariant holding', async () => {
    const sum = await g('summary');
    assert.equal(sum.slots, 5, '3 frames + 2 columns = 5 slots');
    assert.ok(sum.words >= 600 && sum.words <= 900, `story is ${sum.words} words`);
    assert.equal(sum.overset, 0);
    assert.deepEqual(await g('invariants'), []);
    console.log(`    story ${sum.words} words over ${sum.slots} slots`);
  });

  it('frames have clearly different widths and heights', async () => {
    const slots = await a.page.evaluate(() => (window as any).galley.app.slots as { w: number; h: number }[]);
    const widths = new Set(slots.map((s) => s.w));
    const heights = new Set(slots.map((s) => s.h));
    assert.ok(widths.size >= 3 && heights.size >= 3, `widths ${[...widths]} heights ${[...heights]}`);
  });

  it('splits mid-paragraph at line boundaries, and nothing is lost or duplicated at any join', async () => {
    const sl = await g('slices');
    const joins = sl.filter((s: any) => s.startMid);
    assert.ok(joins.length >= 3, `expected >= 3 mid-paragraph joins, got ${joins.length}`);
    // rebuild the story from the slot texts: a join concatenates directly, a paragraph boundary inserts '\n'
    let rebuilt = '';
    sl.forEach((s: any, k: number) => {
      if (s.empty) return;
      rebuilt += (k > 0 && !s.startMid ? '\n' : '') + s.text;
    });
    assert.equal(rebuilt, await g('storyText'), 'concatenated slots == story');
    // and the text actually shown in the frames is the same thing
    const shown: string[] = await g('frameText');
    let rebuiltDom = '';
    shown.forEach((t, k) => (rebuiltDom += (k > 0 && !sl[k].startMid ? '\n' : '') + t));
    assert.equal(rebuiltDom, await g('storyText'), 'concatenated DOM text of the frames == story');
  });

  it('continued paragraphs have no first-line indent and no space-before; fresh paragraphs keep both', async () => {
    const r = await a.page.evaluate(() => {
      const out: any[] = [];
      const slots = (window as any).galley.app.slots;
      const lines = (window as any).galley.lines();
      document.querySelectorAll('#pm .slot').forEach((slot, k) => {
        [...slot.children].forEach((p, i) => {
          const cs = getComputedStyle(p);
          const first = lines[k].find((l: any) => l.para === i);
          out.push({
            k,
            i,
            cont: p.classList.contains('cont'),
            style: (p as HTMLElement).dataset.style,
            indent: cs.textIndent,
            padTop: cs.paddingTop,
            firstLeft: first ? first.left - slots[k].x : null,
          });
        });
      });
      return out;
    });
    const cont = r.filter((x) => x.cont);
    assert.ok(cont.length >= 3);
    for (const c of cont) {
      assert.equal(c.indent, '0px', `slot ${c.k} para ${c.i} continuation has indent`);
      assert.equal(c.padTop, '0px', `slot ${c.k} para ${c.i} continuation has space-before`);
      assert.ok(Math.abs(c.firstLeft) < 0.2, `continuation first line should start at the frame edge, starts at +${c.firstLeft}pt`);
    }
    const fresh = r.filter((x) => !x.cont && x.style === 'body');
    assert.ok(fresh.length >= 3);
    for (const f of fresh) {
      assert.equal(f.indent, '16px', 'body first-line indent is 12pt = 16px');
      assert.ok(Math.abs(f.firstLeft - 12) < 0.2, `fresh body paragraph first line should be indented 12pt, got ${f.firstLeft}`);
    }
    // space-before of a subhead is honoured mid-frame but dropped at the top of a frame
    const subs = r.filter((x) => x.style === 'subhead');
    assert.ok(subs.some((s) => s.i > 0 && s.padTop === '12px'), 'subhead keeps 9pt space-before mid-frame');
    assert.ok(r.filter((x) => x.i === 0).every((x) => x.padTop === '0px'), 'space-before is dropped at the top of every frame');
  });

  it('every frame is full: the next line would not fit, and nothing overflows (measured vs rendered)', async () => {
    // covered by invariants(): "overflows", "is not full", regular leading
    assert.deepEqual(await g('invariants'), []);
  });
});

describe('geometry sweep (greedy fill + joins hold for many frame sizes)', () => {
  it('invariants hold for 40 different frame geometries, including hyphenated joins', async () => {
    let hyJoins = 0;
    let midJoins = 0;
    let configs = 0;
    for (let w1 = 300; w1 <= 504; w1 += 12) {
      for (const w2 of [150, 249]) {
        for (const h1 of [150, 165]) {
          await g('load', { frames: sweepFrames(w1, w2, h1) });
          const bad = await g('invariants');
          assert.deepEqual(bad, [], `w1=${w1} w2=${w2} h1=${h1}`);
          const sl = await g('slices');
          sl.forEach((s: any, k: number) => {
            if (k < sl.length - 1 && s.endMid) midJoins++;
            if (k < sl.length - 1 && s.hy) hyJoins++;
          });
          configs++;
        }
      }
    }
    console.log(`    ${configs} geometries, ${midJoins} mid-paragraph joins, ${hyJoins} hyphenated joins, 0 invariant violations`);
    assert.ok(configs >= 40);
    assert.ok(hyJoins >= 3, 'the sweep must exercise hyphenated joins');
  });
});

describe('hyphenation across a frame break', () => {
  it('a word hyphenated by the engine at a frame end carries its hyphen; the next frame starts with the rest', async () => {
    let found: any = null;
    for (let w = 300; w <= 504 && !found; w += 3) {
      await g('load', { frames: sweepFrames(w, 249) });
      const sl = await g('slices');
      const k = sl.findIndex((s: any, i: number) => i < sl.length - 1 && s.hy);
      if (k >= 0) found = { w, k };
    }
    assert.ok(found, 'no hyphenated join found in the width sweep');
    const { k } = found;
    const lines = await g('lines');
    const last: string = lines[k][lines[k].length - 1].text;
    const next: string = lines[k + 1][0].text;
    assert.ok(last.endsWith('-'), `frame ${k} ends with a hyphen: "${last}"`);
    const prefix = last.split(' ').pop()!.slice(0, -1);
    const rest = next.split(' ')[0];
    const story: string = await g('storyText');
    assert.ok(story.includes(prefix + rest.replace(/[,.;:]+$/, '')), `story contains the whole word "${prefix}"+"${rest}"`);
    assert.ok(!/[‐­]/.test(story), 'the hyphen is never written into the story');
    // the hyphen is drawn by CSS (::after U+2010), is the same glyph the engine draws at in-frame breaks, and the next frame starts un-indented
    const d = await a.page.evaluate((k) => {
      const ps = [...document.querySelectorAll('#pm .slot')[k].children];
      const lastP = ps[ps.length - 1] as HTMLElement;
      const nextP = document.querySelectorAll('#pm .slot')[k + 1].children[0] as HTMLElement;
      return { after: getComputedStyle(lastP, '::after').content, cls: lastP.className, nextCls: nextP.className, nextIndent: getComputedStyle(nextP).textIndent, nextPad: getComputedStyle(nextP).paddingTop };
    }, k);
    assert.equal(d.after, '"‐"');
    assert.ok(d.cls.includes('hy'));
    assert.ok(d.nextCls.includes('cont'));
    assert.equal(d.nextIndent, '0px');
    assert.equal(d.nextPad, '0px');
    assert.deepEqual(await g('invariants'), []);
    console.log(`    hyphenated join at width ${found.w}pt: "...${last.split(' ').slice(-2).join(' ')}" | "${next.split(' ').slice(0, 2).join(' ')}..."`);
  });

  it('with hyphens off there are no hyphenated joins and the invariants still hold', async () => {
    await g('load', { frames: sweepFrames(303, 249), hyphens: false });
    const sl = await g('slices');
    assert.ok(sl.every((s: any) => !s.hy));
    assert.deepEqual(await g('invariants'), []);
  });
});

describe('overset', () => {
  it('shows a red marker and the exact count of overset words when the text runs past the last frame', async () => {
    await g('load', { copy: [...buildLongCopy(2500), 'B|Qzxunique final sentence that must never be rendered.'] });
    const ov = await g('overset');
    assert.ok(ov && ov.words > 500);
    // independent count: the story text must start with what is placed; the rest is overset
    const sl = await g('slices');
    let placed = '';
    sl.forEach((s: any, k: number) => {
      if (!s.empty) placed += (k > 0 && !s.startMid ? '\n' : '') + s.text;
    });
    const story: string = await g('storyText');
    assert.ok(story.startsWith(placed));
    const rest = story.slice(placed.length);
    const independent = (rest.match(/\S+/g) ?? []).length;
    assert.equal(ov.words, independent, 'overset word count vs independent count of the unplaced text');
    const ui = await g('oversetUi');
    assert.ok(ui.visible && ui.portRed);
    assert.equal(ui.text, `Overset: ${independent} words`);
    // the overset text is not in any frame
    const shown: string[] = await g('frameText');
    assert.ok(!shown.join('\n').includes('Qzxunique'), 'the end of the story (overset) is not rendered in any frame');
    assert.ok(story.includes('Qzxunique'));
    assert.deepEqual(await g('invariants'), []);
  });

  it('the marker disappears when the text fits again, and reappears when it overflows', async () => {
    await g('load', {});
    assert.equal((await g('oversetUi')).visible, false);
    // push ~70 words in at the start of frame 1
    await g('insertAt', await g('findPos', 'Every page'), 'overflowing words '.repeat(70));
    const ov = await g('overset');
    assert.ok(ov && ov.words > 0, 'overset after inserting text');
    const ui = await g('oversetUi');
    assert.ok(ui.visible);
    assert.equal(ui.text, `Overset: ${ov.words} words`);
    await g('undo');
    assert.equal((await g('overset')), null, 'overset gone after undo');
    assert.equal((await g('oversetUi')).visible, false);
  });
});

describe('robustness', () => {
  it('a frame too short for a single line is skipped (empty slot), the story continues in the next', async () => {
    await g('load', {
      frames: [
        { id: 'A', x: 54, y: 54, w: 300, h: 6 },
        { id: 'B', x: 54, y: 120, w: 300, h: 300 },
        { id: 'C', x: 54, y: 450, w: 300, h: 300 },
      ],
    });
    const sl = await g('slices');
    assert.equal(sl[0].empty, true);
    assert.equal(sl[1].start, 1);
    assert.deepEqual(await g('invariants'), []);
  });

  it('empty paragraphs and a one-paragraph story thread correctly', async () => {
    await g('load', { copy: ['B|One.', 'B|', 'B|', 'B|Two words here that wrap onto several lines in a narrow frame, with enough text to need a second frame as well.'], frames: [{ id: 'A', x: 54, y: 54, w: 90, h: 60 }, { id: 'B', x: 200, y: 54, w: 90, h: 60 }] });
    assert.deepEqual(await g('invariants'), []);
    await g('load', { copy: ['B|Single paragraph that is long enough to flow through a couple of the narrow frames defined here, so a join is created.'], frames: [{ id: 'A', x: 54, y: 54, w: 90, h: 36 }, { id: 'B', x: 200, y: 54, w: 90, h: 36 }, { id: 'C', x: 300, y: 54, w: 90, h: 120 }] });
    assert.deepEqual(await g('invariants'), []);
  });
});

describe('text wrap around an image frame (invisible floats with shape-outside)', () => {
  it('an ellipse straddling frames 2 and 3: text hugs it in both, nothing enters it, the story reflows, frames stay full', async () => {
    await g('load', {});
    const plain = await g<any[]>('slices');
    await g('load', { page: 'wrap' });
    const slots = await a.page.evaluate(() => (window as any).galley.app.slots as { wraps: any[] }[]);
    assert.deepEqual(slots.map((s) => s.wraps.length), [0, 1, 1, 0, 0], 'floats are injected into exactly the two overlapped frames');
    assert.equal(slots[1].wraps[0].side, 'right');
    assert.equal(slots[2].wraps[0].side, 'left');
    assert.match(slots[1].wraps[0].shape, /^ellipse\(/);
    const sl = await g<any[]>('slices');
    assert.notDeepEqual(sl.map((s) => [s.start, s.end]), plain.map((s) => [s.start, s.end]), 'the wrap changed how the story threads');
    assert.deepEqual(await g('invariants'), [], 'no line enters the ellipse, no overflow, every frame full (re-render probe)');
    // the lines beside the image are measurably shorter than the frame width, and shortest where the ellipse is widest
    const lines = await g<any[][]>('lines');
    const rects = await a.page.evaluate(() => (window as any).galley.app.slots as { x: number; w: number }[]);
    const narrow = (k: number) => lines[k].filter((l) => Math.abs(l.right - l.left) < rects[k].w - 30).length;
    assert.ok(narrow(1) >= 8 && narrow(2) >= 8, `lines shortened beside the image: ${narrow(1)} in frame 2, ${narrow(2)} in frame 3`);
    assert.equal(await g('overset').then((o) => (o ? o.words : 0)) >= 0, true);
  });

  it('removing the wrap restores the original threading exactly (toggle round trip)', async () => {
    await g('load', {});
    const plain = await g<any[]>('slices');
    await g('load', { page: 'wrap' });
    await g('load', { page: 'default' });
    assert.deepEqual((await g<any[]>('slices')).map((s) => [s.start, s.end]), plain.map((s) => [s.start, s.end]));
  });

  it('a line that cannot fit beside a float is pushed below it (irregular line positions): engine still fills and never overflows', async () => {
    // a 30pt strip is left of the obstacle in frame A: most words do not fit beside it, so lines jump below the float
    await g('load', {
      frames: [
        { id: 'A', x: 54, y: 54, w: 150, h: 300 },
        { id: 'B', x: 240, y: 54, w: 300, h: 300 },
        { id: 'C', x: 54, y: 400, w: 486, h: 330 },
      ],
      obstacles: [{ id: 'R', x: 84, y: 120, w: 300, h: 110, shape: 'rect', offset: 0 }],
    });
    assert.deepEqual(await g('invariants'), []);
    const lines = await g<any[][]>('lines');
    const tops = lines[0].map((l) => l.top);
    const gaps = tops.slice(1).filter((t, i) => t - tops[i] > 14);
    assert.ok(gaps.length >= 1, 'a gap in line positions exists in frame A (lines were displaced below the float)');
    assert.deepEqual(await g('checkIncremental'), []);
  });

  for (const [label, opts, seeds] of [
    ['wrap page', { page: 'wrap' }, [1, 2, 3, 4]],
    ['displaced lines', { frames: [{ id: 'A', x: 54, y: 54, w: 150, h: 300 }, { id: 'B', x: 240, y: 54, w: 300, h: 300 }, { id: 'C', x: 54, y: 400, w: 486, h: 330 }], obstacles: [{ id: 'R', x: 84, y: 120, w: 300, h: 110, shape: 'rect', offset: 0 }] }, [1, 2]],
  ] as const) {
    it(`${label}: ${seeds.length} fuzz seeds x 100 edits, incremental == from scratch and all invariants (including the wrap probes)`, async () => {
      for (const seed of seeds) {
        await g('load', opts);
        const r = await g('fuzz', 100, seed);
        assert.deepEqual(r.fails, [], `seed ${seed}`);
      }
    });
  }
});

describe('incremental re-threading: frontier cases', () => {
  it('a paragraph appended after the last frame flows into that frame\'s free space (regression: it was reported as overset)', async () => {
    await g('load', {});
    const before = (await g<any[]>('slices')).at(-1);
    await a.page.evaluate(() => {
      const ed = (window as any).galley.app.editor;
      const para = ed.story.doc.child(0).type.schema.nodes.paragraph.create({ style: 'quote' }, ed.story.doc.type.schema.text('A short pull quote that fits in the spare room of the last column.'));
      ed.runStory((_s: any, d: any) => (d(ed.story.tr.insert(ed.story.doc.content.size, para)), true));
    });
    const after = (await g<any[]>('slices')).at(-1);
    assert.ok(after.end > before.end, 'the last frame took the appended paragraph');
    assert.equal(await g('overset'), null, 'nothing is overset');
    assert.deepEqual(await g('checkIncremental'), [], 'incremental == from scratch');
    assert.deepEqual(await g('invariants'), []);
  });

  it('removing text from the middle pulls the tail back and the last frame refills (and the reverse)', async () => {
    await g('load', {});
    const orig = await g<any[]>('slices');
    const p = await g<number>('findPos', 'A compositor working');
    await a.page.evaluate((p) => {
      const ed = (window as any).galley.app.editor;
      ed.runStory((s: any, d: any) => (d(s.tr.delete(p, p + 400)), true));
    }, p);
    assert.deepEqual(await g('checkIncremental'), []);
    const less = await g<any[]>('slices');
    assert.ok(less.at(-1).end < orig.at(-1).end);
    await g('undo');
    assert.deepEqual((await g<any[]>('slices')).map((s) => [s.start, s.end]), orig.map((s) => [s.start, s.end]));
  });
});

describe('incremental re-threading equals a from-scratch thread', () => {
  // The fuzz biases ~60% of edits to within 2 chars of a slot start/end (where all the real bugs were found: mutation
  // checks of the engine against this fuzz are caught on 36/36, 29/36 and 2/36 of seeds), and always compares the
  // incremental result with a from-scratch thread plus every geometric invariant.
  for (const [label, opts, steps, seeds] of [
    ['default page', {}, 120, [1234, 1, 2, 3, 4, 5]],
    ['three-frame page', { page: 'three' }, 120, [1, 2, 3, 4]],
    ['default page, shorter story (spare room in the last frames)', { copy: BASE_COPY.slice(0, 11) }, 120, [1, 2, 3, 4, 5, 6]],
    ['20-frame chain, 10k words', { page: 'long20', story: 'long', words: 10000 }, 30, [1, 2]],
  ] as const) {
    it(`${label}: ${seeds.length} seeds x ${steps} random edits (insert, delete, split, join, restyle, paragraph insert/append/delete)`, async () => {
      const kinds: Record<string, number> = {};
      for (const seed of seeds) {
        await g('load', opts);
        const r = await g('fuzz', steps, seed);
        for (const [k, v] of Object.entries(r.kinds)) kinds[k] = (kinds[k] ?? 0) + (v as number);
        assert.deepEqual(r.fails, [], `seed ${seed}`);
      }
      console.log(`    ${label}: ${seeds.length * steps} edits ${JSON.stringify(kinds)}`);
    });
  }

  it('Chromium does not hyphenate the LAST word of a paragraph: joining the next paragraph onto it can pull a hyphenated prefix up (frontier reaches the paragraph end)', async () => {
    let cases = 0;
    let moved = 0;
    for (let w = 99; w <= 183; w += 6) {
      for (let n = 4; n <= 8; n++) {
        const filler = 'lorem ipsum dolor sit amet consectetur adipiscing elit'.split(' ').slice(0, n).join(' ');
        await g('load', {
          copy: ['B|' + filler + ' hyphenation', 'B|composition frames and more words follow in this second paragraph so the join has text.'],
          frames: [{ id: 'A', x: 54, y: 54, w, h: 24 }, { id: 'B', x: 300, y: 54, w: 200, h: 200 }],
        });
        const r = await a.page.evaluate(() => {
          const ed = (window as any).galley.app.editor;
          const s = ed.res.slots[0];
          if (!s.endMid) return null;
          const para = ed.idx.paras[ed.idx.find(s.end)];
          if (s.frontier !== para.ce + 2) return null; // first word after the cut is not the paragraph's last word
          const before = s.end + (s.hy ? 'h' : '');
          ed.runStory((st: any, d: any) => (d(st.tr.delete(para.ce, para.ce + 2)), true));
          return { before, after: ed.res.slots[0].end + (ed.res.slots[0].hy ? 'h' : ''), diffs: (window as any).galley.checkIncremental() };
        });
        if (!r) continue;
        cases++;
        if (r.before !== r.after) moved++;
        assert.deepEqual(r.diffs, [], `w=${w} n=${n}: ${r.before} -> ${r.after}`);
      }
    }
    assert.ok(cases >= 5 && moved >= 3, `${cases} last-word cases, in ${moved} the join moved the cut`);
    console.log(`    last-word hyphenation: ${cases} cases, joining the next paragraph moved the cut in ${moved}; incremental == full in all`);
  });

  it('editing the first word after a frame break can pull it (or a hyphenated prefix) up onto the previous frame', async () => {
    // regression: the cut of frame k depends on the whole first word after it, so an edit INSIDE that word, outside
    // frame k's text, must still re-measure frame k
    for (let w = 303; w <= 420; w += 3) {
      await g('load', { frames: sweepFrames(w, 249) });
      let moved = 0;
      for (let step = 0; step < 14; step++) {
        const s0 = (await g<any[]>('slices'))[0];
        if (!s0.endMid || s0.frontier - s0.end < 3) break;
        const before = s0.end;
        await a.page.evaluate((pos) => {
          const ed = (window as any).galley.app.editor;
          ed.runStory((st: any, d: any) => (d(st.tr.delete(pos, pos + 1)), true));
        }, s0.frontier - 1);
        assert.deepEqual(await g('checkIncremental'), [], `width ${w} step ${step}`);
        if ((await g<any[]>('slices'))[0].end !== before) moved++;
      }
      if (moved) return; // found a geometry where deleting letters did pull text up, and every step matched a full re-thread
    }
    assert.fail('no geometry exercised a cut moving because of an edit inside the next word');
  });
});
