import {test,expect} from '../helpers/fixtures';
import {loadDoc,setTool,clickPage} from '../canvas/helpers';
import {getDocument} from '../helpers/app-state';
import {rawPdf} from './proof';
import {pdfWords} from '../../../../scripts/text/pdfcheck';

test.use({open:null});
async function shortFrame(page:Parameters<typeof loadDoc>[0],text='',styledTail=false) {
  await loadDoc(page,{frames:[{id:'short',type:'text',x:36,y:36,w:44,h:14,text}]});
  if(styledTail) await page.evaluate(()=>{
    const g=(window as any).__galley,s=g.store.getState(),source=structuredClone(s.history.doc.stories.story_short.doc);
    source.content[0].attrs={...source.content[0].attrs,overrides:{print:{align:'center'}}};
    source.content.push({type:'paragraph',attrs:{...source.content[0].attrs,overrides:{print:{align:'right'}}},content:[{type:'text',text:'Styled unplaced tail.',marks:[{type:'override',attrs:{shared:{fontWeight:700},print:{baselineShift:3}}}]}]});
    s.dispatch(g.model.setStoryDoc,{storyId:'story_short',doc:source});
  });
  await page.waitForSelector('.galley-page[data-ready=true]');
  await setTool(page,'type');await clickPage(page,{x:45,y:40});await expect(page.getByTestId('text-editor')).toBeFocused();
  const fit=await page.evaluate(()=>{const e=(window as any).__galleyText.editor;return {empty:e.res.slots.every((s:any)=>s.empty),overset:e.res.overset};});
  expect(fit.empty).toBe(true);expect(fit.overset).toBeTruthy();
}
test('native keyboard typing in a zero-fit 44 by 14 pt frame edits one source paragraph',async({galley})=>{
  const {page}=galley;await shortFrame(page);
  for(const [i,char] of [...'FREE'].entries()) {
    await page.keyboard.type(char);
    await expect.poll(async()=>{const source=(await getDocument(page)).stories.story_short.doc;return source.content.map((p:any)=>(p.content ?? []).map((r:any)=>r.text).join('')).join('\n');}).toBe('FREE'.slice(0,i+1));
  }
  const after=await getDocument(page);expect(after.stories.story_short.doc.content).toHaveLength(1);
  await expect(page.locator('[data-testid=overset-count][data-frame-id=short]')).toContainText('1 overset word');
  const layout=await page.evaluate(()=>{const e=(window as any).__galleyText.editor;return {empty:e.res.slots.every((s:any)=>s.empty),cuts:e.res.slots,full:e.fullThreadResult().slots,selection:e.storySelection()};});
  expect(layout.empty).toBe(true);expect(layout.cuts).toEqual(layout.full);expect(layout.selection).toEqual({anchor:5,head:5});
  expect(pdfWords(await rawPdf(galley,'short-frame-zero-fit'))).toEqual([]);
  await page.keyboard.press('Meta+z');expect((await getDocument(page)).stories.story_short.doc.content[0].content ?? []).toEqual([]);
  await page.keyboard.press('Meta+Shift+z');expect((await getDocument(page)).stories.story_short.doc).toEqual(after.stories.story_short.doc);
  await page.evaluate(()=>{const g=(window as any).__galley;g.store.getState().dispatch(g.model.setFrameProps,{ids:['short'],props:{h:20}});});
  await page.waitForSelector('.galley-page[data-ready=true]');expect((await getDocument(page)).stories.story_short.doc).toEqual(after.stories.story_short.doc);
  await expect(page.locator('.galley-page .galley-text[data-frame-id=short]')).toHaveText('FREE');
  expect(pdfWords(await rawPdf(galley,'short-frame-resized')).map(w=>w.text)).toEqual(['FREE']);
});

for(const styledTail of [false,true]) test(`zero-fit IME edits the existing ${styledTail?'styled paragraph and retains marked tail':'empty paragraph'} with one undo`,async({galley})=>{
  const {page}=galley;await shortFrame(page,styledTail?'Unplaced source text.':'',styledTail);
  const before=(await getDocument(page)).stories.story_short.doc;
  await page.evaluate(()=>{
    const e=(window as any).__galleyText.editor;e.setStorySelection(1);e.view.focus();(window as any).__zeroFitComposition=[];
    for(const name of ['compositionstart','compositionend'])e.view.dom.addEventListener(name,()=> (window as any).__zeroFitComposition.push(name));
  });
  const c=await page.context().newCDPSession(page);
  for(const text of ['に','日本']) {
    await c.send('Input.imeSetComposition',{text,selectionStart:text.length,selectionEnd:text.length});
    expect((await getDocument(page)).stories.story_short.doc).toEqual(before);
  }
  await c.send('Input.insertText',{text:'日本'});
  await page.waitForFunction(()=>{const e=(window as any).__galleyText.editor;return !e.composing && !e.pendingRethread;});
  const after=(await getDocument(page)).stories.story_short.doc;
  expect(after.content).toHaveLength(before.content.length);
  expect(after.content[0].attrs).toEqual(before.content[0].attrs);
  expect(after.content[0].content).toEqual([{type:'text',text:'日本'+(styledTail?'Unplaced source text.':'')}]);
  expect(after.content.slice(1)).toEqual(before.content.slice(1));
  const layout=await page.evaluate(()=>{const e=(window as any).__galleyText.editor;return {empty:e.res.slots.every((s:any)=>s.empty),cuts:e.res.slots,full:e.fullThreadResult().slots,selection:e.storySelection(),events:(window as any).__zeroFitComposition};});
  expect(layout.empty).toBe(true);expect(layout.cuts).toEqual(layout.full);expect(layout.selection).toEqual({anchor:3,head:3});expect(layout.events).toEqual(['compositionstart','compositionend']);
  await page.keyboard.type('!');expect((await getDocument(page)).stories.story_short.doc.content[0].content).toEqual([{type:'text',text:'日本!'+(styledTail?'Unplaced source text.':'')}]);
  await page.keyboard.press('Meta+z');expect((await getDocument(page)).stories.story_short.doc).toEqual(before);
});
