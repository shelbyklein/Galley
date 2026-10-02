/**
 * Placing an image (⌘D) and the fitting options.
 *
 * An image frame's `content` is the displayed rectangle of the whole image in points, relative to the frame's top-left, so
 * every fitting option just chooses that rectangle (`fitContent`). Placing asks the main process to show the file dialog and
 * link the file into the package (`window.galley.placeImage`, see src/main/place-image); this module turns the answer
 * into an asset and an image frame, in one undo step.
 */
import { addAsset, addFrame, createId, setFrameProps, type Asset, type GalleyDocument, type Id, type ImageContent, type ImageFrame } from '@galley/model';
import type { StoreApi } from 'zustand/vanilla';
import type { PlacedImage } from '../../shared/ipc';
import type { EditorState } from '../store';
import { round4 } from '../canvas/geometry';
import { targetLayerId } from './actions';
import { normalizeSelection } from './selection-model';

type StoreLike = Pick<StoreApi<EditorState>, 'getState'>;

export type FitMode = 'fillProportionally' | 'fitProportionally' | 'contentToFrame' | 'center';

const rounded = (c: ImageContent): ImageContent => ({ x: round4(c.x), y: round4(c.y), w: round4(c.w), h: round4(c.h) });

/**
 * The content rectangle a fitting option gives an image in a frame (frame size in points, the image's pixel size for its
 * aspect ratio, and the rectangle it has now for Center Content).
 *   fillProportionally   cover the frame at the image's own aspect ratio, centered; the overflow is cropped
 *   fitProportionally    the largest image at its own aspect ratio that fits inside the frame, centered
 *   contentToFrame       exactly the frame, whatever that does to the aspect ratio
 *   center               keep the size, center it in the frame
 */
export function fitContent(mode: FitMode, frame: { w: number; h: number }, asset: Pick<Asset, 'width' | 'height'>, current: ImageContent | null): ImageContent {
  const fw = Math.max(frame.w, 0.01);
  const fh = Math.max(frame.h, 0.01);
  const aspect = asset.width / asset.height;
  switch (mode) {
    case 'contentToFrame':
      return rounded({ x: 0, y: 0, w: fw, h: fh });
    case 'center': {
      const c = current ?? { x: 0, y: 0, w: fw, h: fh };
      return rounded({ x: (frame.w - c.w) / 2, y: (frame.h - c.h) / 2, w: c.w, h: c.h });
    }
    case 'fillProportionally':
    case 'fitProportionally': {
      const w = mode === 'fillProportionally' ? Math.max(fw, fh * aspect) : Math.min(fw, fh * aspect);
      const h = w / aspect;
      return rounded({ x: (frame.w - w) / 2, y: (frame.h - h) / 2, w, h });
    }
  }
}

/** The selected image frames that hold an image. */
export function fittableFrames(doc: GalleyDocument, selection: readonly Id[]): ImageFrame[] {
  return normalizeSelection(doc, selection)
    .map((id) => doc.frames[id])
    .filter((f): f is ImageFrame => f?.type === 'image' && f.assetId !== null && f.content !== null && !!doc.assets[f.assetId]);
}

/** Apply a fitting option to the selected image frames, in one step. Returns false when there is nothing to fit. */
export function applyFit(store: StoreLike, mode: FitMode): boolean {
  const s = store.getState();
  const frames = fittableFrames(s.history.doc, s.selection);
  if (frames.length === 0) return false;
  const label = { fillProportionally: 'Fill Frame Proportionally', fitProportionally: 'Fit Content Proportionally', contentToFrame: 'Fit Content to Frame', center: 'Center Content' }[mode];
  s.beginTransaction(label);
  try {
    for (const f of frames) {
      const asset = s.history.doc.assets[f.assetId!]!;
      store.getState().dispatch(setFrameProps, { ids: [f.id], props: { content: fitContent(mode, f, asset, f.content) } });
    }
    store.getState().commitTransaction();
  } catch (error) {
    store.getState().cancelTransaction();
    throw error;
  }
  return true;
}

/** Points per inch: an image of `px` pixels at `ppi` is `px / ppi * 72` points across. */
const naturalPt = (px: number, ppi: number): number => (px / ppi) * 72;

/** The API the renderer needs from the main process (`window.galley`): the dialog and linking happen there. */
export interface PlaceApi {
  placeImage(): Promise<PlacedImage | null>;
}

/**
 * Place an image: ask for a file, then put it in the selected image frame (filled proportionally) or in a new frame at the
 * margin corner, at its native size (scaled down to fit inside the margins when larger). One undo step.
 * Returns the frame's id, or null when the dialog was cancelled.
 */
export async function placeImage(store: StoreLike, api: PlaceApi | undefined = (globalThis as { window?: { galley?: PlaceApi } }).window?.galley): Promise<Id | null> {
  if (!api?.placeImage) throw new Error('Placing images needs the Galley app (window.galley.placeImage is missing)');
  const placed = await api.placeImage();
  if (!placed) return null;

  const s = store.getState();
  const doc = s.history.doc;
  const existing = Object.values(doc.assets).find((a) => a.path === placed.path && a.hash === placed.hash);
  const asset: Asset = existing ?? {
    id: createId('asset'),
    kind: 'image',
    path: placed.path,
    hash: placed.hash,
    width: placed.width,
    height: placed.height,
    ppi: placed.ppi,
    colorSpace: placed.colorSpace,
  };

  const selected = normalizeSelection(doc, s.selection);
  const target = selected.length === 1 ? doc.frames[selected[0]!] : undefined;
  const intoFrame = target?.type === 'image' ? target : undefined;
  const layerId = intoFrame ? intoFrame.layerId : targetLayerId(doc, selected);
  if (!layerId) return null; // every layer is hidden or locked

  s.beginTransaction('Place Image');
  try {
    if (!existing) store.getState().dispatch(addAsset, { asset });
    let frameId: Id;
    if (intoFrame) {
      frameId = intoFrame.id;
      store.getState().dispatch(setFrameProps, { ids: [frameId], props: { assetId: asset.id, content: fitContent('fillProportionally', intoFrame, asset, null) } });
    } else {
      const page = doc.pages[s.currentPageId]!;
      const natW = naturalPt(asset.width, asset.ppi);
      const natH = naturalPt(asset.height, asset.ppi);
      const room = { w: Math.max(page.width - page.margins.left - page.margins.right, 1), h: Math.max(page.height - page.margins.top - page.margins.bottom, 1) };
      const scale = Math.min(1, room.w / natW, room.h / natH);
      const w = round4(natW * scale);
      const h = round4(natH * scale);
      frameId = createId('frm');
      const name = placed.path.split('/').pop() ?? '';
      store.getState().dispatch(addFrame, {
        frame: { id: frameId, type: 'image', name, layerId, x: page.margins.left, y: page.margins.top, w, h, rotation: 0, fill: null, stroke: null, assetId: asset.id, content: { x: 0, y: 0, w, h } },
        pageId: s.currentPageId,
      });
    }
    store.getState().commitTransaction();
    store.getState().setSelection([frameId]);
    return frameId;
  } catch (error) {
    store.getState().cancelTransaction();
    throw error;
  }
}
