import {test,expect} from '../helpers/fixtures';
import {textFixture} from './helpers';
import {rawPdf,pdfBaselines,screenBaselines} from './proof';
import {clickPage,setTool} from '../canvas/helpers';
import {snap} from '../helpers/screenshot';
test.use({open:null});
for(const {chars,narrow} of [{chars:1,narrow:false},{chars:2,narrow:false},{chars:2,narrow:true}]) test(`grid-aligned ${chars}-character drop cap${narrow?' in a narrow frame':''} shares native layout with editor and PDF`,async({galley},info)=>{
  const {page}=galley;await textFixture(page,true,800);
  await page.evaluate(chars=>{
    const g=(window as any).__galley,s=g.store.getState(),p=s.history.doc.stories.story_t1.doc.content[0];
    s.dispatch(g.model.setStoryDoc,{storyId:'story_t1',doc:{type:'doc',content:[{...p,attrs:{...p.attrs,overrides:{print:{fontSize:9,leading:12,hyphenate:false,alignToBaselineGrid:true,dropCapLines:3,dropCapChars:chars}}},content:[{type:'text',text:'A',marks:[{type:'override',attrs:{shared:{fontWeight:700}}}]},{type:'text',text:'B',marks:[{type:'override',attrs:{shared:{fontStyle:'italic'}}}]},{type:'text',text:' '+Array.from({length:800},(_,i)=>'word'+i).join(' ')}]}]}});
  },chars);
  if(narrow)await page.evaluate(()=>{const g=(window as any).__galley;g.store.getState().dispatch(g.model.setFrameProps,{ids:['t1'],props:{w:40}});});
  await page.waitForSelector('.galley-page[data-ready=true]');
  const screen=await page.evaluate(screenBaselines),pdf=pdfBaselines(await rawPdf(galley,`grid-dropcap-${chars}`)).filter(s=>Math.abs(s.size-9)<.01);
  expect(screen.length).toBeGreaterThan(40);expect(Math.max(...screen.map(s=>Math.abs(s.y-Math.round(s.y/12)*12)))).toBeLessThanOrEqual(.1);
  expect(Math.max(...pdf.map(s=>Math.abs(s.y-Math.round(s.y/12)*12)))).toBeLessThanOrEqual(.1);
  const wordBox=async(root:string)=>page.evaluate(root=>{
    const p=document.querySelector(root)!,walker=document.createTreeWalker(p,NodeFilter.SHOW_TEXT),pageBox=document.querySelector('.galley-page')!.getBoundingClientRect(),scale=pageBox.width/612;
    for(let node=walker.nextNode();node;node=walker.nextNode()) {const i=(node as Text).data.indexOf('word0');if(i<0)continue;const r=document.createRange();r.setStart(node,i);r.setEnd(node,i+5);const b=r.getBoundingClientRect();return {x:(b.x-pageBox.x)/scale,y:(b.y-pageBox.y)/scale,w:b.width/scale,h:b.height/scale};}throw new Error('word0 missing');
  },root);
  const staticBox=await wordBox('.galley-page .galley-text[data-frame-id=t1] p');
  await setTool(page,'type');await clickPage(page,{x:staticBox.x+4,y:staticBox.y+6});await expect(page.getByTestId('text-editor')).toBeFocused();
  const editorBox=await wordBox('[data-testid=text-editor] .slot[data-frame-id=t1] p');
  for(const key of ['x','y','w','h'] as const)expect(Math.abs(staticBox[key]-editorBox[key]),`${key}: ${JSON.stringify({staticBox,editorBox})}`).toBeLessThanOrEqual(.1);
  await snap(page,`grid-dropcap-${chars}${narrow?'-narrow':''}`,{testInfo:info});
});
