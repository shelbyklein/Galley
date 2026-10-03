import type { Asset, ImageFrame } from './schema';

/** Pixel axes stay local to the content; cropping and frame rotation do not change resolution. */
export function effectiveImagePpi(asset: Pick<Asset, 'width' | 'height'>, frame: Pick<ImageFrame, 'content'>): { x: number; y: number } | null {
  const c = frame.content;
  return c && c.w > 0 && c.h > 0 ? { x: asset.width * 72 / c.w, y: asset.height * 72 / c.h } : null;
}
