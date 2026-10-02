/**
 * File > Place (⌘D), the main-process half: show the open dialog, read the image's metadata, and link the file into the
 * open package by copying it to `<package>/assets/`, so the document's image path is a relative path inside the package
 * (`assets/<name>`) and moves with it. The renderer turns the answer into an asset and an image frame.
 *
 * With no package open yet (an unsaved document) the file goes to a scratch package in the temp folder, which becomes the
 * active package, so `galley-asset://` serves it; Save As copies the active package's assets into the new package.
 */
import { BrowserWindow, dialog, ipcMain } from 'electron';
import { IPC, type PlacedImage } from '../../shared/ipc';
import { ensureActivePackage } from '../package';
import { linkImage } from './link';

/** Register the `place-image` IPC handler. */
export function registerPlaceImage(): void {
  ipcMain.handle(IPC.placeImage, async (event): Promise<PlacedImage | null> => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const options = { title: 'Place', properties: ['openFile' as const], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg'] }] };
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    const source = result.filePaths[0];
    if (result.canceled || !source) return null;

    // An unsaved document gets a scratch package (lane C's package.ts); Save As copies its images into the real one.
    return linkImage(ensureActivePackage(), source);
  });
}
