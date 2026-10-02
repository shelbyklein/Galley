import fs from 'node:fs';
import path from 'node:path';
import {test,expect} from '../helpers/fixtures';
import {REPO_ROOT} from '../helpers/launch';
import {snap} from '../helpers/screenshot';
import {textFixture} from './helpers';
import {clickPage,setTool} from '../canvas/helpers';
test.use({open:null});
test('active editor refreshes exact installed-font cuts and caret after delayed menu loading',async({galley},info)=>{
  const {page}=galley;
  const families=await page.evaluate(()=> (window as any).galley?.fonts?.families());
  test.skip(!families,'Installed font menu integration requires lanes N and S.');
  const eligible=families.filter((f:any)=>f.source==='system' && f.faces.some((s:any)=>s.source==='system' && s.weight===400 && s.style==='normal' && s.format==='truetype'));
  const family=eligible.find((f:any)=>f.family==='Roboto') ?? eligible[0];expect(family).toBeTruthy();
  await textFixture(page,true,800);await setTool(page,'type');await clickPage(page,{x:90,y:48});await expect(page.getByTestId('text-editor')).toBeFocused();
  await page.evaluate(async({family,staleBytes})=>{
    // A previous package can leave different bytes registered under the same visible family.
    const bytes=Uint8Array.from(atob(staleBytes),c=>c.charCodeAt(0));
    const stale=new FontFace(family,bytes.buffer,{weight:'400',style:'normal'});await stale.load();document.fonts.add(stale);
    const original=FontFace.prototype.load;let released=false;const pending:(()=>void)[]=[];
    (window as any).__releaseExactFont=()=>{released=true;pending.splice(0).forEach(f=>f());};
    FontFace.prototype.load=function(){const result=original.call(this);if(this.family.replace(/^['"]|['"]$/g,'')!==family)return result;
      return result.then(face=>released?face:new Promise<FontFace>(resolve=>{(window as any).__exactFontHeld=true;pending.push(()=>resolve(face));}));};
    const ed=(window as any).__galleyText.editor,offset=ed.story.doc.textContent.indexOf('word220');ed.setStorySelection(1,1+offset);
  },{family:family.family,staleBytes:fs.readFileSync(path.join(REPO_ROOT,'scripts/text/fonts/Inter-Bold.ttf')).toString('base64')});
  const strip=page.getByTestId('type-control-strip');await strip.locator('[data-type-control=fontFamily]').selectOption(family.family);
  await strip.locator('[data-type-control=fontStyle]').selectOption('400:normal');await page.waitForFunction(()=>!!(window as any).__exactFontHeld);
  const before=await page.evaluate(()=>{
    const ed=(window as any).__galleyText.editor,pos=1+ed.story.doc.textContent.indexOf('word215')+2;ed.setStorySelection(pos);ed.view.focus();
    const detail={kind:'overrides',patch:{set:{shared:{fontWeight:700}}},handled:false};window.dispatchEvent(new CustomEvent('galley:caret-format',{detail}));
    return {cuts:ed.res.slots,selection:ed.storySelection(),marks:ed.story.storedMarks?.map((m:any)=>m.toJSON()),doc:ed.story.doc.toJSON(),handled:detail.handled};
  });expect(before.handled).toBe(true);
  await page.evaluate(()=> (window as any).__releaseExactFont());await page.waitForSelector('.galley-page[data-ready=true]');
  const after=await page.evaluate(()=>{
    const ed=(window as any).__galleyText.editor,full=ed.fullThreadResult(),pos=ed.storySelection().head,c=ed.view.coordsAtPos(ed.vmap.storyToView(pos));
    const frame=[...document.querySelectorAll<HTMLElement>('.galley-page .galley-text')].find(f=>Number(f.dataset.storyStart)<=pos && Number(f.dataset.storyEnd)>pos)!;
    let offset=pos-Number(frame.dataset.storyStart);const walker=document.createTreeWalker(frame,NodeFilter.SHOW_TEXT);
    for(let n=walker.nextNode();n;n=walker.nextNode()){const t=n as Text;if(offset>t.length){offset-=t.length;continue;}const r=document.createRange();r.setStart(t,offset);r.collapse(true);const b=r.getBoundingClientRect(),scale=document.querySelector('.galley-page')!.getBoundingClientRect().width/612;
      return {cuts:ed.res.slots,full:full.slots,selection:ed.storySelection(),marks:ed.story.storedMarks?.map((m:any)=>m.toJSON()),doc:ed.story.doc.toJSON(),caret:{dx:Math.abs(c.left-b.left)/scale,dy:Math.abs(c.top-b.top)/scale}};}throw new Error('Native caret anchor missing');
  });
  expect(after.full).not.toEqual(before.cuts);expect(after.cuts).toEqual(after.full);
  expect(after.doc).toEqual(before.doc);expect(after.selection).toEqual(before.selection);expect(after.marks).toEqual(before.marks);
  expect(after.caret.dx).toBeLessThanOrEqual(.1);expect(after.caret.dy).toBeLessThanOrEqual(.1);
  await snap(page,'text-editor-exact-font-loaded',{testInfo:info});
  console.log(`exact ${family.family}400 delayed menu load: editor/full cuts equal, caret dx/dy ${after.caret.dx}/${after.caret.dy}pt, source/selection/stored marks preserved`);
});

for(const extraParagraphs of [false,true]) test(`font completion preserves IME and overset ${extraParagraphs?'styled paragraphs':'tail'} through commit and undo`,async({galley})=>{
  const {page}=galley;await textFixture(page,true,800);
  if(extraParagraphs) await page.evaluate(()=>{
    const g=(window as any).__galley,s=g.store.getState(),doc=structuredClone(s.history.doc.stories.story_t1.doc),attrs=doc.content[0].attrs;
    doc.content.push({type:'paragraph',attrs,content:[{type:'text',text:'Preserve this styled overset paragraph.',marks:[{type:'override',attrs:{shared:{fontWeight:700},print:{baselineShift:3}}}]}]},
      {type:'paragraph',attrs,content:[{type:'text',text:'And this final overset paragraph.'}]});
    s.dispatch(g.model.setStoryDoc,{storyId:'story_t1',doc});
  });
  await page.waitForSelector('.galley-page[data-ready=true]');await setTool(page,'type');await clickPage(page,{x:90,y:48});
  await expect(page.getByTestId('text-editor')).toBeFocused();
  const before=await page.evaluate(()=>{
    const e=(window as any).__galleyText.editor,g=(window as any).__galley,pos=e.res.slots[0].end;e.setStorySelection(pos,pos,0);e.view.focus();
    (window as any).__fontCompositionEvents=[];
    for(const name of ['compositionstart','compositionend']) e.view.dom.addEventListener(name,()=> (window as any).__fontCompositionEvents.push(name));
    return {pos,text:e.story.doc.textBetween(0,e.story.doc.content.size,'\n'),source:g.store.getState().history.doc.stories.story_t1.doc,overset:e.res.overset};
  });
  expect(before.overset).toBeTruthy();
  const c=await page.context().newCDPSession(page);
  await c.send('Input.imeSetComposition',{text:'に',selectionStart:1,selectionEnd:1});
  const during=await page.evaluate(()=>{
    const e=(window as any).__galleyText.editor,g=(window as any).__galley,node=e.view.dom.firstChild,res=e.res;
    const original=e.rethreadAll.bind(e);let calls=0;e.rethreadAll=()=>{calls++;original();};
    window.dispatchEvent(new CustomEvent('galley:text-fonts-ready',{detail:{pageId:g.model.pageIdOf(g.store.getState().history.doc,'t1')}}));
    return {composing:e.composing,pending:e.pendingRethread,sameDOM:node===e.view.dom.firstChild,sameLayout:res===e.res,calls,source:g.store.getState().history.doc.stories.story_t1.doc};
  });
  expect(during).toEqual({composing:true,pending:true,sameDOM:true,sameLayout:true,calls:0,source:before.source});
  await c.send('Input.imeSetComposition',{text:'日本',selectionStart:2,selectionEnd:2});
  await c.send('Input.insertText',{text:'日本'});
  await page.waitForFunction(()=>{const e=(window as any).__galleyText.editor;return !e.composing && !e.pendingRethread;});
  await expect(page.getByTestId('text-editor')).not.toHaveAttribute('data-composition-paint');
  await expect(page.locator('.galley-page .galley-text[data-story-id=story_t1][data-composition-hidden]')).toHaveCount(0);
  for(const f of await page.locator('.galley-page .galley-text[data-story-id=story_t1]').all()) await expect(f).toHaveCSS('visibility','visible');
  const after=await page.evaluate(()=>{
    const e=(window as any).__galleyText.editor,g=(window as any).__galley;
    const source=g.store.getState().history.doc.stories.story_t1.doc,selection=e.storySelection(),mapped=e.vmap.viewToStory(e.view.state.selection.head);
    return {text:e.story.doc.textBetween(0,e.story.doc.content.size,'\n'),cuts:e.res.slots,full:e.fullThreadResult().slots,events:(window as any).__fontCompositionEvents,plain:g.model.storyPlainText(source),source,selection,mapped};
  });
  expect(after.text).toBe(before.text.slice(0,before.pos-1)+'日本'+before.text.slice(before.pos-1));
  expect(after.plain).toBe(after.text);expect(after.cuts).toEqual(after.full);expect(after.events).toEqual(['compositionstart','compositionend']);
  const expected=structuredClone(before.source);const run=expected.content[0].content[0];run.text=run.text.slice(0,before.pos-1)+'日本'+run.text.slice(before.pos-1);
  expect(after.source).toEqual(expected);expect(after.selection).toEqual({anchor:before.pos+2,head:before.pos+2});expect(after.mapped).toBe(after.selection.head);
  await page.keyboard.press('Meta+z');
  expect(await page.evaluate(()=> (window as any).__galley.store.getState().history.doc.stories.story_t1.doc)).toEqual(before.source);
  expect(await page.evaluate(()=>{const e=(window as any).__galleyText.editor;return e.story.doc.textBetween(0,e.story.doc.content.size,'\n');})).toBe(before.text);
});
