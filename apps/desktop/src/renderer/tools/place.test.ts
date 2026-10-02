import { serializeDocument, validateDocument } from '@galley/model';
import { describe, expect, it } from 'vitest';
import type { PlacedImage } from '../../shared/ipc';
import { createEditorStore } from '../store';
import { applyFit, fitContent, fittableFrames, placeImage } from './place';
import { blank, PAGE } from './testing';

const asset = { width: 1600, height: 1000 }; // 1.6 : 1

describe('fitContent', () => {
  it('fill proportionally covers the frame at the image aspect, centered', () => {
    // a wide frame: the width decides
    expect(fitContent('fillProportionally', { w: 300, h: 100 }, asset, null)).toEqual({ x: 0, y: -43.75, w: 300, h: 187.5 });
    // a tall frame: the height decides, the width overflows both sides
    expect(fitContent('fillProportionally', { w: 100, h: 200 }, asset, null)).toEqual({ x: -110, y: 0, w: 320, h: 200 });
  });

  it('fit proportionally is the largest image that fits, centered', () => {
    expect(fitContent('fitProportionally', { w: 300, h: 100 }, asset, null)).toEqual({ x: 70, y: 0, w: 160, h: 100 });
    expect(fitContent('fitProportionally', { w: 100, h: 200 }, asset, null)).toEqual({ x: 0, y: 68.75, w: 100, h: 62.5 });
  });

  it('fit content to frame is exactly the frame', () => {
    expect(fitContent('contentToFrame', { w: 300, h: 100 }, asset, { x: 5, y: 5, w: 10, h: 10 })).toEqual({ x: 0, y: 0, w: 300, h: 100 });
  });

  it('center keeps the size and centers it in the frame', () => {
    expect(fitContent('center', { w: 300, h: 100 }, asset, { x: -20, y: 9, w: 160, h: 100 })).toEqual({ x: 70, y: 0, w: 160, h: 100 });
    expect(fitContent('center', { w: 100, h: 100 }, asset, { x: 0, y: 0, w: 300, h: 150 })).toEqual({ x: -100, y: -25, w: 300, h: 150 });
  });

  it('fill covers and fit contains: fill is never smaller than fit', () => {
    for (const frame of [{ w: 50, h: 400 }, { w: 400, h: 50 }, { w: 160, h: 100 }, { w: 3.3, h: 7.7 }]) {
      const fill = fitContent('fillProportionally', frame, asset, null);
      const fit = fitContent('fitProportionally', frame, asset, null);
      expect(fill.w).toBeGreaterThanOrEqual(frame.w - 1e-3);
      expect(fill.h).toBeGreaterThanOrEqual(frame.h - 1e-3);
      expect(fit.w).toBeLessThanOrEqual(frame.w + 1e-3);
      expect(fit.h).toBeLessThanOrEqual(frame.h + 1e-3);
      // both keep the image's aspect ratio
      expect(fill.w / fill.h).toBeCloseTo(1.6, 2);
      expect(fit.w / fit.h).toBeCloseTo(1.6, 1);
    }
  });
});

const placed: PlacedImage = { path: 'assets/photo.png', hash: `sha256:${'a'.repeat(64)}`, width: 1600, height: 1000, ppi: 200, colorSpace: 'rgb' };

describe('placeImage', () => {
  const setup = () => {
    const store = createEditorStore(blank());
    const api = { placeImage: async (): Promise<PlacedImage | null> => placed };
    return { store, api, s: () => store.getState() };
  };

  it('creates the asset and a frame at the margin corner, scaled to fit the margins, in one undo step', async () => {
    const { store, api, s } = setup();
    const before = serializeDocument(s().history.doc).document;
    const id = await placeImage(store, api);
    const doc = s().history.doc;
    const frame = doc.frames[id!]!;
    expect(Object.values(doc.assets)).toEqual([expect.objectContaining({ path: 'assets/photo.png', hash: placed.hash, width: 1600, height: 1000, ppi: 200, colorSpace: 'rgb' })]);
    // native size 576 x 360 pt; margin box 540 x 720
    expect(frame).toMatchObject({ type: 'image', x: 36, y: 36, w: 540, h: 337.5, name: 'photo.png', content: { x: 0, y: 0, w: 540, h: 337.5 } });
    expect(s().selection).toEqual([id]);
    expect(s().history.past).toHaveLength(1);
    expect(validateDocument(doc)).toEqual([]);
    s().undo();
    expect(serializeDocument(s().history.doc).document).toBe(before);
  });

  it('places a small image at its native size', async () => {
    const { store, s } = setup();
    const id = await placeImage(store, { placeImage: async () => ({ ...placed, width: 300, height: 150, ppi: 150 }) });
    expect(s().history.doc.frames[id!]).toMatchObject({ w: 144, h: 72 });
  });

  it('reuses an asset that is already linked', async () => {
    const { store, api, s } = setup();
    await placeImage(store, api);
    s().clearSelection(); // with the first frame selected, the second image would go into it
    await placeImage(store, api);
    expect(Object.keys(s().history.doc.assets)).toHaveLength(1);
    expect(s().history.doc.pages[PAGE]!.items).toHaveLength(2);
  });

  it('puts the image in a selected image frame, filled proportionally, without adding a frame', async () => {
    const { store, api, s } = setup();
    const first = await placeImage(store, api);
    s().dispatch((await import('@galley/model')).setFrameProps, { ids: [first!], props: { w: 300, h: 100 } });
    s().setSelection([first!]);
    await placeImage(store, { placeImage: async () => ({ ...placed, path: 'assets/other.png', hash: `sha256:${'b'.repeat(64)}` }) });
    const doc = s().history.doc;
    expect(doc.pages[PAGE]!.items).toEqual([first]);
    expect(doc.frames[first!]).toMatchObject({ w: 300, h: 100, content: { x: 0, y: -43.75, w: 300, h: 187.5 } });
    expect(doc.assets[(doc.frames[first!] as { assetId: string }).assetId]!.path).toBe('assets/other.png');
  });

  it('does nothing when the dialog is cancelled, and says so when the app API is missing', async () => {
    const { store, s } = setup();
    expect(await placeImage(store, { placeImage: async () => null })).toBeNull();
    expect(s().history.past).toHaveLength(0);
    await expect(placeImage(store, undefined)).rejects.toThrow(/window\.galley/);
  });
});

describe('applyFit', () => {
  it('fits every selected image frame in one step and leaves other frames alone', async () => {
    const store = createEditorStore(blank());
    const api = { placeImage: async () => placed };
    const s = () => store.getState();
    const a = await placeImage(store, api);
    s().clearSelection();
    const b = await placeImage(store, api);
    s().dispatch((await import('@galley/model')).setFrameProps, { ids: [a!, b!], props: { w: 100, h: 100 } });
    s().setSelection([a!, b!]);
    const steps = s().history.past.length;
    expect(fittableFrames(s().history.doc, s().selection)).toHaveLength(2);
    expect(applyFit(store, 'fitProportionally')).toBe(true);
    expect(s().history.past.length).toBe(steps + 1);
    for (const id of [a!, b!]) expect(s().history.doc.frames[id]).toMatchObject({ content: { x: 0, y: 18.75, w: 100, h: 62.5 } });
    s().setSelection([]);
    expect(applyFit(store, 'center')).toBe(false);
  });
});
