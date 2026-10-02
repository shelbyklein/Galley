import {test,expect} from '../helpers/fixtures';
import {textFixture} from './helpers';
import {clickPage,setTool} from '../canvas/helpers';
import {editorCall} from './editor-api';
test.use({open:null});
for(const shift of [3,30]) test(`paint-only +/-${shift} pt shifts preserve threaded cuts and incremental editing`,async({galley})=>{
  const {page}=galley;await textFixture(page,true,800);
  const read=()=>page.locator('.galley-page .galley-text p').allTextContents();
  const original=await read();
  await page.evaluate(shift=>{
    const g=(window as any).__galley,s=g.store.getState(),p=s.history.doc.stories.story_t1.doc.content[0];
    s.dispatch(g.model.setStoryDoc,{storyId:'story_t1',doc:{type:'doc',content:[{...p,content:Array.from({length:800},(_,i)=>({type:'text',text:'word'+i+(i<799?' ':''),marks:[{type:'override',attrs:{print:{baselineShift:i%2?shift:-shift}}}]}))}]}});
  },shift);
  await page.waitForSelector('.galley-page[data-ready=true]');expect(await read()).toEqual(original);
  await setTool(page,'type');await clickPage(page,{x:90,y:48});await expect(page.getByTestId('text-editor')).toBeFocused();
  expect((await editorCall<any[]>(page,'slices')).map(s=>s.text)).toEqual(original);
  expect(await editorCall(page,'checkIncremental')).toEqual([]);
  const slices=await editorCall<any[]>(page,'slices');await editorCall(page,'setSelection',slices[0].end-20);
  await page.keyboard.type(' moving words ');expect(await editorCall(page,'checkIncremental')).toEqual([]);expect(await editorCall(page,'invariants')).toEqual([]);
});
