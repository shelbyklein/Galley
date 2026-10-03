/**
 * File > Place (⌘D), the main-process half: show the open dialog, read the image's metadata, and link the file into the
 * open package by copying it to `<package>/assets/`, so the document's image path is a relative path inside the package
 * (`assets/<name>`) and moves with it. The renderer turns the answer into an asset and an image frame.
 *
 * With no package open yet (an unsaved document) the file goes to a scratch package in the temp folder, which becomes the
 * active package, so `galley-asset://` serves it; Save As copies the active package's assets into the new package.
 */
import { assetSchema } from '@galley/model';
import { inspectLinks } from './check';
import { BrowserWindow, dialog, ipcMain, nativeImage } from 'electron';
import { IPC, type PlacedImage } from '../../shared/ipc';
import { ensureActivePackage, getActivePackage, getPackageEpoch, setMissingLinks } from '../package';
import { linkImage } from './link';

/** Register the `place-image` IPC handler. */
export function registerPlaceImage(): void {
  ipcMain.handle(IPC.imagesCheck, (_event, assets: unknown) => {
    const statuses = inspectLinks(getActivePackage(), assets, (bytes) => !nativeImage.createFromBuffer(bytes).isEmpty());
    setMissingLinks(statuses.filter((s) => s.status === 'missing' || s.status === 'unreadable').map(({ assetId, path }) => ({ assetId, path })));
    return statuses;
  });
  ipcMain.handle(IPC.imagesRelink, async (event, input: unknown): Promise<PlacedImage | null> => {
    const asset = assetSchema.parse(input);
    const epoch = getPackageEpoch();
    const win = BrowserWindow.fromWebContents(event.sender);
    const options = { title: `Relink ${asset.path.split('/').pop()}`, properties: ['openFile' as const], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg'] }] };
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) return null;
    if (getPackageEpoch() !== epoch) throw new Error('The document changed while choosing a replacement. Try again in the current document.');
    return linkImage(ensureActivePackage(), result.filePaths[0], (bytes) => !nativeImage.createFromBuffer(bytes).isEmpty());
  });
  ipcMain.handle(IPC.placeImage, async (event): Promise<PlacedImage | null> => {
    const epoch = getPackageEpoch();
    const win = BrowserWindow.fromWebContents(event.sender);
    const options = { title: 'Place', properties: ['openFile' as const], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg'] }] };
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    const source = result.filePaths[0];
    if (result.canceled || !source) return null;

    // An unsaved document gets a scratch package (lane C's package.ts); Save As copies its images into the real one.
    if (getPackageEpoch() !== epoch) throw new Error('The document changed while choosing an image.');
    return linkImage(ensureActivePackage(), source, (bytes) => !nativeImage.createFromBuffer(bytes).isEmpty());
  });
}
