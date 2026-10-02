import type { Page } from '@playwright/test';
import { BASE_COPY,buildStory } from '../../../../scripts/text/fixture/story';
import { STYLES } from '../../../../scripts/text/fixture/styles';
import { getPage,expandSlots,type FrameDef } from '../../../../scripts/text/fixture/frames';
import { clickPage } from '../canvas/helpers';
const story=buildStory(BASE_COPY).toJSON();
export async function loadEditor(page:Page,o:{frames?:FrameDef[]}={}) {
  await page.keyboard.press('Escape');
  const pg=o.frames?{frames:o.frames}:getPage('default');
  const frames=expandSlots(pg.frames).map((s,i)=>({id:`f${i}`,x:s.x,y:s.y,w:s.w,h:s.h}));
  await page.evaluate(({frames,story,styles})=>{
    const g=(window as any).__galley,m=g.model;
    const doc=m.createDocument({engineVersion:'44.5.1',page:{id:'page_1',width:612,height:792,bleed:0,slug:0},layer:{id:'layer_1'}});
    for(const st of Object.values(styles) as any[]) doc.paragraphStyles[st.id]={id:st.id,name:st.label,basedOn:m.BASIC_PARAGRAPH_ID,shared:{fontFamily:'Inter',fontWeight:st.weight,fontStyle:st.italic?'italic':'normal'},print:{fontSize:st.font,leading:st.leading,firstLineIndent:st.indent,spaceBefore:st.before,spaceAfter:st.after,align:st.align}};
    let history=m.createHistory(doc);
    frames.forEach((f,i)=>{
      const textStory=m.createStory(`s${i}`,'');if(i===0) textStory.doc=m.normalizeNativeStoryDoc(story,doc);
      history=m.applyCommand(history,m.addFrame,{pageId:'page_1',frame:{...f,type:'text',name:'',layerId:'layer_1',rotation:0,fill:null,stroke:null,storyId:`s${i}`,inset:0},story:textStory});
      if(i>0) history=m.applyCommand(history,m.linkFrames,{fromId:`f${i-1}`,toId:f.id});
    });
    const s=g.store.getState();s.openDocument(history.doc);s.setSelection(['f0']);s.setActiveTool('type');
  },{frames,story,styles:STYLES});
  await page.waitForSelector('.galley-page[data-ready="true"]');
  const f=frames[0]!;await clickPage(page,{x:f.x+35,y:f.y+12});
  await page.waitForFunction(()=>!!(window as any).__galleyText?.editor);
  await page.getByTestId('text-editor').focus();
}
export async function editorCall<T=any>(page:Page,name:string,...args:any[]):Promise<T> {
  if(name==='load') {await loadEditor(page,args[0]);return undefined as T;}
  return page.evaluate(({name,args})=>{
    const api=(window as any).__galleyText,ed=api.editor,doc=ed.story.doc;
    const slices=()=>ed.res.slots.map((r:any,k:number)=>({...r,slot:k,text:r.empty?'':doc.textBetween(r.start,r.end,'\n')}));
    switch(name) {
      case 'focus':ed.view.focus();return;
      case 'setSelection':ed.setStorySelection(args[0],args[1] ?? args[0],args[2]);return;
      case 'selection':return ed.storySelection();
      case 'storyText':return doc.textBetween(0,doc.content.size,'\n');
      case 'storyParas':return doc.content.content.map((p:any)=>p.textContent);
      case 'slices':return slices();
      case 'overset':return ed.res.overset;
      case 'oversetUi':return {text:document.querySelector('[data-testid="overset-count"]')?.textContent ?? ''};
      case 'coordsAt':{const c=ed.view.coordsAtPos(ed.vmap.storyToView(args[0],args[1] ?? -1));return {x:c.left,top:c.top,bottom:c.bottom};}
      case 'caret':{const sel=getSelection();if(!sel?.rangeCount)return null;const r=sel.getRangeAt(0),box=r.getClientRects()[0] ?? r.getBoundingClientRect();const el=(r.startContainer.nodeType===1?r.startContainer as Element:r.startContainer.parentElement)?.closest<HTMLElement>('.slot');return {slot:el?Number(el.dataset.slot):-1,x:box.left,y:box.top};}
      case 'findPos':{for(const p of ed.idx.paras){const i=p.node.textContent.indexOf(args[0]);if(i>=0)return p.cs+i;}throw new Error('Text not found');}
      case 'selectionText':{const sel=ed.storySelection();return doc.textBetween(Math.min(sel.anchor,sel.head),Math.max(sel.anchor,sel.head),'\n');}
      case 'composing':return ed.composing||ed.pendingRethread;
      case 'lines':return api.lines();
      case 'checkIncremental':{const full=ed.fullThreadResult();const errors:string[]=[];full.slots.forEach((s:any,k:number)=>{if(JSON.stringify(s)!==JSON.stringify(ed.res.slots[k]))errors.push(`slot${k} differs`);});if(JSON.stringify(full.overset)!==JSON.stringify(ed.res.overset))errors.push('overset differs');return errors;}
      case 'invariants':{const errors:string[]=[];const sl=slices();[...ed.view.dom.children].forEach((el:any,k)=>{const rendered=[...el.querySelectorAll('p')].map((p:any)=>p.textContent).join('\n');if(rendered!==sl[k].text)errors.push(`slot${k} DOM/story mismatch`);const top=el.getBoundingClientRect().top;const p=el.lastElementChild;if(p){const bottom=p.getBoundingClientRect().bottom-parseFloat(getComputedStyle(p).paddingBottom);const scale=el.getBoundingClientRect().height/(ed.slots[k].h*4/3);if((bottom-top)/scale>ed.slots[k].h*4/3+0.05)errors.push(`slot${k} overflow`);}});return errors;}
      case 'marksAt':{const out:any[]=[],g=(window as any).__galley,tables=g.store.getState().history.doc;doc.nodesBetween(args[0],args[1],(n:any,pos:number)=>{if(n.isText){const r=g.model.resolveParagraph(tables,g.model.paragraphAttrs(doc.resolve(pos).parent.toJSON()));out.push({text:n.text.slice(Math.max(0,args[0]-pos),Math.min(n.text.length,args[1]-pos)),marks:n.marks.map((m:any)=>m.type.name),weight:g.model.resolveRun(tables,r,n.toJSON().marks).fontWeight});}});return out;}
      default:throw new Error('Unknown editor call '+name);
    }
  },{name,args}) as Promise<T>;
}
