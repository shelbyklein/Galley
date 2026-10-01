/**
 * Images in a `.galley` package are loaded by windows through a custom protocol the main process serves:
 *   galley-asset://pkg/<path relative to the package folder>
 * The main process resolves it against the currently open package (src/main/package.ts) and refuses anything that
 * escapes the folder. Both the editor window and the hidden export window use the same URLs.
 */
export const ASSET_SCHEME = 'galley-asset';

export function assetUrl(relativePath: string): string {
  return `${ASSET_SCHEME}://pkg/${relativePath.split('/').map(encodeURIComponent).join('/')}`;
}
