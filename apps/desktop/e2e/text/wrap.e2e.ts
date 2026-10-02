import {test,expect} from '../helpers/fixtures';
import {getDocument,runCommand} from '../helpers/app-state';
import {snap} from '../helpers/screenshot';
import {clickPage,setTool} from '../canvas/helpers';
import {textFixture,collectScreenLines} from './helpers';
import {rawPdf,pdfBaselines,screenBaselines} from './proof';
import {editorCall} from './editor-api';
import {pdfWords,pdfLinesBySlot,compareLines,type PdfWord} from '../../../../scripts/text/pdfcheck';
test.use({open:null});
const ellipse={x:246,y:330,w:84,h:132};
function intersects(w:PdfWord,offset:number,rotation=0) {
  const cx=ellipse.x+ellipse.w/2,cy=ellipse.y+ellipse.h/2;
  if(rotation) {
    // Minimise the independently rotated ellipse quadratic over all four box edges.
    const angle=rotation*Math.PI/180,cos=Math.cos(angle),sin=Math.sin(angle),rx=ellipse.w/2+offset,ry=ellipse.h/2+offset;
    const a=cos*cos/(rx*rx)+sin*sin/(ry*ry),b=cos*sin*(1/(rx*rx)-1/(ry*ry)),c=sin*sin/(rx*rx)+cos*cos/(ry*ry);
    const l=w.x0-cx,r=w.x1-cx,t=w.y0-cy,bottom=w.y1-cy,q=(x:number,y:number)=>a*x*x+2*b*x*y+c*y*y;
    if(l<=0 && r>=0 && t<=0 && bottom>=0)return true;
    return Math.min(...[l,r].map(x=>q(x,Math.max(t,Math.min(bottom,-b*x/c)))),...[t,bottom].map(y=>q(Math.max(l,Math.min(r,-b*y/a)),y)))<1;
  }
  const x=Math.max(w.x0,Math.min(w.x1,cx)),y=Math.max(w.y0,Math.min(w.y1,cy));
  return ((x-cx)/(ellipse.w/2+offset))**2+((y-cy)/(ellipse.h/2+offset))**2<1;
}
async function wrapFixture(page:Parameters<typeof textFixture>[0]) {
  await textFixture(page,true,800);
  await page.evaluate(ellipse=>{
    const g=(window as any).__galley,s=g.store.getState();
    s.dispatch(g.model.addFrame,{pageId:'page_1',frame:{id:'wrap',name:'Wrap ellipse',type:'ellipse',layerId:'layer_1',rotation:0,fill:{swatchId:g.model.SWATCH_BLACK,tint:100,overprint:false},stroke:null,...ellipse}});s.setSelection(['wrap']);
  },ellipse);
  await runCommand(page,'window.textWrap');await expect(page.getByTestId('wrap-mode')).toBeVisible();
}
test('contour panel offset leaves every PDF glyph box outside the expanded ellipse and shares screen lines',async({galley},info)=>{
  const {page}=galley;await wrapFixture(page);
  const original=await page.locator('.galley-page .galley-text p').allTextContents();
  await page.getByTestId('wrap-mode').selectOption('contour');
  const field=page.locator('[data-field=wrap-offset-top]');await field.fill('12 pt');await field.press('Enter');
  expect((await getDocument(page)).frames.wrap.textWrap).toEqual({mode:'contour',offset:12});
  await page.waitForSelector('.galley-page[data-ready=true]');
  const screen=await page.evaluate(collectScreenLines),pdf=await rawPdf(galley,'wrap-contour-12'),words=pdfWords(pdf);
  const collisions=words.filter(w=>intersects(w,12));expect(words.length).toBeGreaterThan(500);expect(collisions).toEqual([]);
  const comparison=compareLines(screen.lines,pdfLinesBySlot(words,screen.slots));expect(comparison.mismatches,comparison.details.join('\n')).toBe(0);
  expect(await page.locator('.galley-page .galley-text p').allTextContents()).not.toEqual(original);
  await snap(page,'wrap-panel-and-flow',{testInfo:info});
  await field.fill('18');await field.press('Enter');expect((await getDocument(page)).frames.wrap.textWrap).toEqual({mode:'contour',offset:18});
  await page.waitForSelector('.galley-page[data-ready=true]');expect(pdfWords(await rawPdf(galley,'wrap-contour-18')).filter(w=>intersects(w,18))).toEqual([]);
  await runCommand(page,'edit.undo');expect((await getDocument(page)).frames.wrap.textWrap).toEqual({mode:'contour',offset:12});
  await page.getByTestId('wrap-mode').selectOption('none');await page.waitForSelector('.galley-page[data-ready=true]');
  expect(await page.locator('.galley-page .galley-text p').allTextContents()).toEqual(original);
  console.log(`actual app contour12: ${words.length} independent PDF glyph boxes, zero ellipse+offset intersections; ${comparison.domLines} matching screen/PDF lines`);
});
test('rotated ellipse contour and baseline grid share absolute screen/PDF geometry',async({galley})=>{
  const {page}=galley;await wrapFixture(page);
  await page.evaluate(()=>{const g=(window as any).__galley,s=g.store.getState();s.dispatch(g.model.setFrameProps,{ids:['wrap'],props:{rotation:30}});s.dispatch(g.model.setTextOverrides,{storyId:'story_t1',range:{from:{paragraph:0,offset:0},to:{paragraph:0,offset:0}},target:'paragraph',patch:{set:{print:{alignToBaselineGrid:true}}}});});
  await page.getByTestId('wrap-mode').selectOption('contour');await page.waitForSelector('.galley-page[data-ready=true]');
  const pdf=await rawPdf(galley,'wrap-rotated-grid'),words=pdfWords(pdf);expect(words.length).toBeGreaterThan(500);expect(words.filter(w=>intersects(w,12,30))).toEqual([]);
  const screen=await page.evaluate(collectScreenLines),c=compareLines(screen.lines,pdfLinesBySlot(words,screen.slots));expect(c.mismatches,c.details.join('\n')).toBe(0);
  const baselines=await page.evaluate(screenBaselines);expect(Math.max(...baselines.map(s=>Math.abs(s.y-Math.round(s.y/12)*12)))).toBeLessThanOrEqual(.1);
  expect(Math.max(...pdfBaselines(pdf).map(s=>Math.abs(s.y-Math.round(s.y/12)*12)))).toBeLessThanOrEqual(.1);
});
test('bounding-box directional offsets edit the model, change native flow, and undo together',async({galley})=>{
  const {page}=galley;await wrapFixture(page);await page.getByTestId('wrap-mode').selectOption('boundingBox');
  const defaults=JSON.stringify((await getDocument(page)).frames.wrap.textWrap);
  for(const [side,value] of Object.entries({top:8,right:16,bottom:20,left:24})) {const field=page.locator(`[data-field=wrap-offset-${side}]`);await field.fill(String(value));await field.press('Enter');}
  expect((await getDocument(page)).frames.wrap.textWrap).toEqual({mode:'boundingBox',offsets:{top:8,right:16,bottom:20,left:24}});
  await page.waitForSelector('.galley-page[data-ready=true]');
  const words=pdfWords(await rawPdf(galley,'wrap-bounding-offsets'));
  expect(words.filter(w=>w.x1>ellipse.x-24 && w.x0<ellipse.x+ellipse.w+16 && w.y1>ellipse.y-8 && w.y0<ellipse.y+ellipse.h+20)).toEqual([]);
  for(let i=0;i<4;i++)await runCommand(page,'edit.undo');expect(JSON.stringify((await getDocument(page)).frames.wrap.textWrap)).toBe(defaults);
});
test('actual wrapped cross-frame editor keeps incremental and full layout equal through boundary-biased edits',async({galley})=>{
  const {page}=galley;await wrapFixture(page);await page.getByTestId('wrap-mode').selectOption('contour');
  await setTool(page,'type');await clickPage(page,{x:90,y:48});await expect(page.getByTestId('text-editor')).toBeFocused();
  const result=await page.evaluate(()=>{
    const ed=(window as any).__galleyText.editor,errors:string[]=[],kinds:Record<string,number>={};let state=891234;
    const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
    for(let step=0;step<240;step++) {
      const boundaries=ed.res.slots.filter((s:any)=>!s.empty).flatMap((s:any)=>[s.start,s.end]);
      const boundary=boundaries[Math.floor(random()*boundaries.length)],p=ed.idx.paras[ed.idx.find(boundary)];
      const pos=Math.max(p.cs,Math.min(p.ce,boundary+Math.floor(random()*5)-2)),op=random();let kind='';
      ed.runStory((s:any,dispatch:any)=>{const tr=s.tr;
        if(op<.5){kind='insert';tr.insertText(' added ',pos);}
        else if(op<.8 && pos<p.ce){kind='delete';tr.delete(pos,Math.min(p.ce,pos+1+Math.floor(random()*30)));}
        else if(op<.94){kind='split';tr.split(pos);}
        else if(p.ce<ed.story.doc.content.size-1){kind='join';tr.delete(p.ce,p.ce+2);}
        else {kind='insert';tr.insertText(' tail ',pos);}
        dispatch(tr);return true;
      });kinds[kind]=(kinds[kind]??0)+1;
      const full=ed.fullThreadResult();if(JSON.stringify(full.slots)!==JSON.stringify(ed.res.slots)||JSON.stringify(full.overset)!==JSON.stringify(ed.res.overset)){errors.push('step'+step+' '+kind);break;}
    }
    return {errors,kinds};
  });
  expect(result.errors).toEqual([]);expect(Object.values(result.kinds).reduce((a,b)=>a+b,0)).toBe(240);expect(await editorCall(page,'invariants')).toEqual([]);
  console.log('actual app wrap fuzz240 edits',result.kinds);
});
