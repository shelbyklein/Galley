import type { Page } from '@playwright/test';
import { loadDoc } from '../canvas/helpers';
export const settle = (page:Page,ms=40)=>page.evaluate(t=>new Promise<void>(r=>setTimeout(r,t)),ms);
export function sweepFrames(w1:number,w2:number,h1=156) {
  return [{id:'A',x:54,y:54,w:w1,h:h1},{id:'B',x:54,y:228,w:w2,h:288},{id:'C',x:54,y:534,w:504,h:222,cols:2,gutter:18}];
}
export function posToOffset(paras:string[],pos:number) {
  let acc=1,off=0;
  for(const p of paras) {if(pos<=acc+p.length)return off+pos-acc;acc+=p.length+2;off+=p.length+1;}
  throw new Error('Story position out of range '+pos);
}
export async function textFixture(page:Page,linked=true,words=800) {
  await loadDoc(page,{page:{width:612,height:792,bleed:0,slug:0},frames:[
    {id:'t1',type:'text',x:36,y:36,w:540,h:180,text:Array.from({length:words},(_,i)=>`word${i}`).join(' ')},
    {id:'t2',type:'text',x:36,y:234,w:258,h:510,text:''},
    {id:'t3',type:'text',x:312,y:234,w:264,h:510,text:''}
  ]});
  await page.evaluate(link => {
    const g=(window as any).__galley,m=g.model,s=g.store.getState();
    s.dispatch(m.setTextOverrides,{storyId:'story_t1',range:{from:{paragraph:0,offset:0},to:{paragraph:0,offset:s.history.doc.stories.story_t1.doc.content[0].content[0].text.length}},target:'paragraph',patch:{set:{print:{fontSize:9,leading:12,hyphenate:false}}}});
    if(link) {s.dispatch(m.linkFrames,{fromId:'t1',toId:'t2'});s.dispatch(m.linkFrames,{fromId:'t2',toId:'t3'});}
    s.setSelection(['t1']);
  },linked);
  await page.waitForSelector('.galley-page[data-ready="true"]');
}
/** Word ranges are independent of the thread engine's character-cut binary search. Coordinates in page points. */
export function collectScreenLines() {
  const page=document.querySelector('.galley-page') as HTMLElement;
  const pageBox=page.getBoundingClientRect();
  const scale=pageBox.width / parseFloat(page.style.width);
  const groups: {text:string;left:number;cy:number}[][]=[];
  const slots:{x:number;y:number;w:number;h:number}[]=[];
  for(const el of [...page.querySelectorAll<HTMLElement>('.galley-text[data-frame-id]')]) {
    const box=el.getBoundingClientRect();
    slots.push({x:(box.left-pageBox.left)/scale,y:(box.top-pageBox.top)/scale,w:box.width/scale,h:box.height/scale});
    const words:{text:string;left:number;cy:number}[]=[];
    for(const p of [...el.querySelectorAll('p')]) {
      const walker=document.createTreeWalker(p,NodeFilter.SHOW_TEXT);
      for(let n=walker.nextNode();n;n=walker.nextNode()) {
        const t=n as Text;
        for(const m of t.data.matchAll(/\S+/g)) {
          const r=document.createRange();r.setStart(t,m.index!);r.setEnd(t,m.index!+m[0].length);
          const boxes=[...r.getClientRects()].filter(b=>b.width>0);
          if(boxes.length!==1) throw new Error('Word wraps in unhyphenated fixture: '+m[0]);
          const b=boxes[0]!;words.push({text:m[0],left:(b.left-pageBox.left)/scale,cy:((b.top+b.bottom)/2-pageBox.top)/scale});
        }
      }
    }
    words.sort((a,b)=>a.cy-b.cy||a.left-b.left);
    const lines:typeof groups=[];
    for(const w of words) {const last=lines.at(-1);if(last && Math.abs(last[0]!.cy-w.cy)<1) last.push(w);else lines.push([w]);}
    (groups as any).push(lines.map(l=>({text:l.map(w=>w.text).join(' '),left:l[0]!.left,cy:l[0]!.cy})));
  }
  return {lines:groups as any,slots};
}
