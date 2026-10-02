import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { test,expect } from '../helpers/fixtures';
import { APP_DIR,REPO_ROOT } from '../helpers/launch';
import { getDocumentJson } from '../helpers/app-state';
import { textFixture,collectScreenLines } from './helpers';
import { compareLines,pdfLinesBySlot,pdfWords } from '../../../../scripts/text/pdfcheck';
test.use({open:null});
test('shared renderer threads the story and hidden export matches every screen line',async({galley})=>{
  const {page,app}=galley;
  await textFixture(page);
  const frames=page.locator('.galley-page .galley-text');
  await expect(frames).toHaveCount(3);
  expect(await frames.nth(1).textContent()).not.toBe('');
  const ranges=await frames.evaluateAll(els=>els.map(e=>({start:Number((e as HTMLElement).dataset.storyStart),end:Number((e as HTMLElement).dataset.storyEnd)})));
  expect(ranges[0]!.end).toBe(ranges[1]!.start);
  expect(ranges[1]!.end).toBe(ranges[2]!.start);
  const dom=await page.evaluate(collectScreenLines);
  const document=await getDocumentJson(page);
  const url=pathToFileURL(path.join(APP_DIR,'out/renderer/export-page/index.html')).href;
  const pdf=await app.evaluate(async({BrowserWindow},{url,document})=>{
    const win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,backgroundThrottling:false}});
    try {await win.loadURL(url);await win.webContents.executeJavaScript(`window.galleyExport.load(${JSON.stringify({document,links:'{"formatVersion":2,"links":{}}'})})`);return (await win.webContents.printToPDF({preferCSSPageSize:true,printBackground:true,margins:{top:0,right:0,bottom:0,left:0},scale:1})).toString('base64');} finally {win.destroy();}
  },{url,document});
  const file=path.join(REPO_ROOT,'scripts/text/out/app-thread.pdf');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,Buffer.from(pdf,'base64'));
  const compared=compareLines(dom.lines,pdfLinesBySlot(pdfWords(file),dom.slots));
  expect(compared.mismatches,compared.details.join('\n')).toBe(0);
  expect(compared.domLines).toBeGreaterThan(50);
  console.log(`actual PageView screen/hidden export ${compared.domLines} lines, 0 mismatches`);
});
