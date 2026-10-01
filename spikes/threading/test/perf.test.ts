// Re-thread cost per keystroke, measured inside the page (performance.now around the whole commit: un-thread, story
// transaction, incremental thread, view doc build, EditorView DOM patch, forced style+layout) and keydown -> end of commit.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { launch, outDir, settle, stats, type App } from './helpers';

let a: App;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g = <T = any>(name: string, ...args: any[]) => a.page.evaluate(([n, ar]) => (window as any).galley[n](...(ar as any[])), [name, args] as [string, any[]]) as Promise<T>;
const TEXT = 'The quick brown fox jumps over the lazy dog and keeps on typing for a while. ';
const report: Record<string, any> = {};

before(async () => {
  a = await launch();
});
after(async () => {
  console.log('\n    scenario'.padEnd(52) + 'keys   total(ms) med / p95 / max   thread med   latency med   slots measured avg/max');
  for (const [k, v] of Object.entries(report)) {
    if (v.total) console.log(`    ${k.padEnd(46)} ${String(v.total.n).padStart(4)}   ${v.total.median.toFixed(2).padStart(6)} / ${v.total.p95.toFixed(2).padStart(6)} / ${v.total.max.toFixed(2).padStart(6)}   ${v.thread.median.toFixed(2).padStart(6)}      ${v.latency.median.toFixed(2).padStart(6)}        ${v.measuredAvg.toFixed(1)} / ${v.measuredMax}`);
    else console.log(`    ${k.padEnd(46)} ${JSON.stringify(v)}`);
  }
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'perf.json'), JSON.stringify(report, null, 2));
  await a?.close();
});

async function collect(label: string) {
  await settle(a.page, 30);
  const log: any[] = await g('statsLog');
  const t = log.filter((x) => x.kind === 'view' || x.kind === 'story');
  assert.ok(t.length > 10, `${label}: collected ${t.length} samples`);
  const f = (k: string) => stats(t.map((x) => x[k]));
  const r = {
    total: f('total'),
    thread: f('thread'),
    build: f('build'),
    view: f('view'),
    layout: f('layout'),
    latency: stats(t.filter((x) => x.latency > 0).map((x) => x.latency)),
    measuredAvg: t.reduce((s, x) => s + x.measured, 0) / t.length,
    measuredMax: Math.max(...t.map((x) => x.measured)),
    slots: t[0].slots,
  };
  report[label] = r;
  return r;
}

async function fresh(opts: object, place: (sl: any[]) => [number, number]) {
  await g('load', opts);
  await settle(a.page, 150);
  const sl = await g<any[]>('slices');
  const [pos, slot] = place(sl);
  await g('focus');
  await g('setSelection', pos, pos, slot);
  await a.page.keyboard.type('warm up the JIT and the layout caches a little. ', { delay: 0 });
  await a.page.keyboard.press('Meta+z');
  await settle(a.page, 600);
  await g('clearStats');
  await g('setSelection', pos, pos, slot);
}

const CONFIGS: [string, object, string][] = [
  ['(a) 800 words, 3 frames + 2-col (5 slots)', {}, 'a5'],
  ['(a) 800 words, 3 frames (3 slots)', { page: 'three' }, 'a3'],
  ['(b) 10k words, 20 frames (20 slots)', { page: 'long20', story: 'long', words: 10000 }, 'b20'],
];

for (const [name, opts, id] of CONFIGS) {
  describe(name, () => {
    it('typing in the first frame (the common case)', async () => {
      await fresh(opts, (sl) => [sl[0].start + 40, 0]);
      await a.page.keyboard.type(TEXT.repeat(5), { delay: 0 });
      const r = await collect(`${id}: type 380 chars in frame 1`);
      if (id !== 'b20') {
        assert.ok(r.total.p95 < 16, `p95 ${r.total.p95.toFixed(2)}ms must be under 16ms`);
        assert.ok(r.total.max < 16, `max ${r.total.max.toFixed(2)}ms must be under 16ms`);
        assert.ok(r.latency.p95 < 16, `keydown->commit p95 ${r.latency.p95.toFixed(2)}ms`);
      } else {
        assert.ok(r.total.max < 50, `max ${r.total.max.toFixed(2)}ms`);
      }
    });

    it('typing in a middle frame, then holding Backspace', async () => {
      await fresh(opts, (sl) => [sl[Math.floor(sl.length / 2)].start + 60, Math.floor(sl.length / 2)]);
      await a.page.keyboard.type(TEXT.repeat(5), { delay: 0 });
      const typed = await collect(`${id}: type 380 chars in middle frame`);
      await g('clearStats');
      for (let i = 0; i < 300; i++) await a.page.keyboard.press('Backspace');
      const back = await collect(`${id}: 300 x Backspace`);
      if (id !== 'b20') {
        assert.ok(typed.total.p95 < 16 && back.total.p95 < 16, `p95 typed ${typed.total.p95.toFixed(2)}, backspace ${back.total.p95.toFixed(2)}`);
      }
    });

    it('worst case: every keystroke re-threads the whole chain (Enter at the top of frame 1, then Backspace)', async () => {
      await fresh(opts, (sl) => [sl[0].start + 12, 0]);
      for (let i = 0; i < 30; i++) await a.page.keyboard.press('Enter');
      const enter = await collect(`${id}: 30 x Enter at top of frame 1 (full cascade)`);
      await g('clearStats');
      for (let i = 0; i < 30; i++) await a.page.keyboard.press('Backspace');
      const back = await collect(`${id}: 30 x Backspace (full cascade back)`);
      const slots = enter.slots;
      assert.ok(enter.measuredMax >= Math.min(slots, 3), `cascade measured up to ${enter.measuredMax} of ${slots} slots`);
      if (id !== 'b20') assert.ok(enter.total.max < 16 && back.total.max < 16, `cascade max ${enter.total.max.toFixed(2)} / ${back.total.max.toFixed(2)}ms`);
      else assert.ok(enter.total.max < 60 && back.total.max < 60, `cascade max ${enter.total.max.toFixed(2)} / ${back.total.max.toFixed(2)}ms`);
    });

    it('where the time goes in a from-scratch thread (build DOM / browser layout / character probes)', async () => {
      await fresh(opts, (sl) => [sl[0].start + 40, 0]);
      const r = await a.page.evaluate(() => {
        const gl = (window as any).galley;
        for (let i = 0; i < 5; i++) gl.fullThreadMs();
        const before = gl.measurerStats();
        const t0 = performance.now();
        const N = 15;
        for (let i = 0; i < N; i++) gl.fullThreadMs();
        const per = (performance.now() - t0) / N;
        const after = gl.measurerStats();
        return {
          totalMs: per,
          buildMs: (after.buildMs - before.buildMs) / N,
          layoutMs: (after.layoutMs - before.layoutMs) / N,
          probeMs: (after.probeMs - before.probeMs) / N,
          probes: (after.probes - before.probes) / N,
          paras: (after.paras - before.paras) / N,
          slots: (after.slots - before.slots) / N,
        };
      });
      const pct = (x: number) => Math.round((100 * x) / r.totalMs);
      report[`${id}: full-thread time split`] = { totalMs: +r.totalMs.toFixed(2), 'browser layout %': pct(r.layoutMs), 'DOM build %': pct(r.buildMs), 'char probes %': pct(r.probeMs), probesPerThread: Math.round(r.probes), parasLaidOut: Math.round(r.paras) };
      assert.ok(r.layoutMs > r.buildMs && r.layoutMs > r.probeMs, 'browser layout dominates');
    });

    it('paste of ~500 words (a single story-level edit), and a from-scratch re-thread for comparison', async () => {
      await fresh(opts, (sl) => [sl[0].start + 40, 0]);
      const words = TEXT.repeat(40);
      await a.page.evaluate((w) => {
        const dt = new DataTransfer();
        dt.setData('text/plain', w);
        (document.getElementById('pm') as HTMLElement).dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      }, words);
      await settle(a.page, 30);
      const s = await g('stats');
      const full: number[] = [];
      for (let i = 0; i < 7; i++) full.push(await g('fullThreadMs'));
      report[`${id}: paste 500 words (one commit)`] = { commitMs: +s.total.toFixed(2), measured: s.measured, slots: s.slots };
      report[`${id}: from-scratch thread of whole story`] = { medianMs: +stats(full).median.toFixed(2), maxMs: +stats(full).max.toFixed(2) };
      assert.deepEqual(await g('invariants'), []);
    });
  });
}
