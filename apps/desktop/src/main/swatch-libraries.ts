import { BrowserWindow, dialog, ipcMain } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { IPC } from '../shared/ipc';
import { parseSwatchLibrary, SWATCH_LIBRARY_MAX_BYTES, type SwatchLibrary } from '../shared/swatch-library';

export function registerSwatchLibraries(): void {
  ipcMain.handle(IPC.swatchesLoadLibrary, async (event): Promise<SwatchLibrary | null> => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const options = { title: 'Load Swatch Library', properties: ['openFile' as const], filters: [{ name: 'Galley Swatch Library (JSON)', extensions: ['json'] }] };
    const chosen = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    if (chosen.canceled || !chosen.filePaths[0]) return null;
    const file = chosen.filePaths[0];
    if (!fs.statSync(file).isFile() || fs.statSync(file).size > SWATCH_LIBRARY_MAX_BYTES) throw new Error('A swatch library must be a JSON file of at most 1 MB.');
    let raw: unknown;
    try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch { throw new Error('The selected file is not valid swatch library JSON.'); }
    return parseSwatchLibrary(raw);
  });
  ipcMain.handle(IPC.swatchesSaveLibrary, async (event, input: unknown): Promise<boolean> => {
    const library = parseSwatchLibrary(input);
    const text = JSON.stringify(library, null, 2) + '\n';
    if (Buffer.byteLength(text) > SWATCH_LIBRARY_MAX_BYTES) throw new Error('Swatch library exceeds 1 MB.');
    const win = BrowserWindow.fromWebContents(event.sender);
    const options = { title: 'Save Swatch Library', defaultPath: 'Swatches.galley-swatches.json', filters: [{ name: 'Galley Swatch Library (JSON)', extensions: ['json'] }], properties: ['showOverwriteConfirmation' as const, 'createDirectory' as const] };
    const chosen = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
    if (chosen.canceled || !chosen.filePath) return false;
    const target = chosen.filePath.toLowerCase().endsWith('.json') ? chosen.filePath : chosen.filePath + '.json';
    const temp = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.tmp`);
    try { fs.writeFileSync(temp, text, { encoding: 'utf8', flag: 'wx' }); fs.renameSync(temp, target); }
    finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
    return true;
  });
}
