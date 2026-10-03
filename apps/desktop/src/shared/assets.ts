/**
 * Images in a `.galley` package are loaded by windows through a custom protocol the main process serves:
 *   galley-asset://pkg/<path relative to the package folder>[?v=<generation>]
 * The main process resolves it against the currently open package (src/main/package.ts) and refuses anything that
 * escapes the folder; the query is ignored. Both the editor window and the hidden export window use the same URLs.
 */
export const ASSET_SCHEME = 'galley-asset';

let generation = 0;
const listeners = new Set<() => void>();
export const getAssetGeneration = () => generation;
export function subscribeAssets(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; }

/**
 * Call when a different package becomes the open one. Image URLs then change (`?v=n`), so an `<img>` whose path is
 * the same in the new document (`assets/photo.jpg` in two documents, or a missing file put back) loads the new file
 * instead of keeping the old picture. Lane C calls it on every open.
 */
export function bumpAssetGeneration(): void {
  generation++;
  for (const listener of listeners) listener();
}

export function assetUrl(relativePath: string): string {
  const url = `${ASSET_SCHEME}://pkg/${relativePath.split('/').map(encodeURIComponent).join('/')}`;
  return generation > 0 ? `${url}?v=${generation}` : url;
}
