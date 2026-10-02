import {test,expect} from '../helpers/fixtures';
import {getDocument,runCommand} from '../helpers/app-state';
import {snap} from '../helpers/screenshot';
import {textFixture,collectScreenLines} from './helpers';
import {rawPdf,pdfBaselines,screenBaselines} from './proof';
import {compareLines,pdfLinesBySlot,pdfWords} from '../../../../scripts/text/pdfcheck';
test.use({open:null});
const distance=(y:number,start:number,increment:number)=>Math.abs(y-(start+Math.round((y-start)/increment)*increment));
for(const leading of [12,13,13.5,14.5,15.25]) test(`native print line parity with unrestricted ${leading} pt leading`,async({galley})=>{
  const {page}=galley;await textFixture(page,true,1000);
  await page.evaluate(leading=>{const g=(window as any).__galley,s=g.store.getState();s.dispatch(g.model.setTextOverrides,{storyId:'story_t1',range:{from:{paragraph:0,offset:0},to:{paragraph:0,offset:0}},target:'paragraph',patch:{set:{print:{leading}}}});},leading);
  await page.waitForSelector('.galley-page[data-ready=true]');
  const screen=await page.evaluate(collectScreenLines),pdf=await rawPdf(galley,`leading-${leading}`),compared=compareLines(screen.lines,pdfLinesBySlot(pdfWords(pdf),screen.slots));
  expect(compared.mismatches,compared.details.join('\n')).toBe(0);
  const actual=(await getDocument(page)).stories.story_t1.doc.content[0].attrs.overrides.print.leading;expect(actual).toBe(leading);
  console.log(`leading ${leading}: ${compared.domLines} screen/PDF lines; ${compared.mismatches} mismatches; dy spread ${compared.dySpread.toFixed(4)}pt`);
});
for(const increment of [12,13.5,13]) test(`absolute grid baseline screen/PDF at ${increment} pt with fractional start and inset`,async({galley},info)=>{
  const {page}=galley;await textFixture(page,true,800);
  await page.evaluate(increment=>{
    const g=(window as any).__galley,s=g.store.getState();
    s.dispatch(g.model.setFrameProps,{ids:['t1','t2','t3'],props:{inset:3.6}});
    s.dispatch(g.model.setBaselineGrid,{start:2.25,increment});
    s.dispatch(g.model.setTextOverrides,{storyId:'story_t1',range:{from:{paragraph:0,offset:0},to:{paragraph:0,offset:0}},target:'paragraph',patch:{set:{print:{alignToBaselineGrid:true}}}});
  },increment);
  await page.waitForSelector('.galley-page[data-ready=true]');
  await runCommand(page,'view.showBaselineGrid');await expect(page.getByTestId('baseline-grid')).toBeVisible();
  const screen=await page.evaluate(screenBaselines),pdf=await rawPdf(galley,`grid-${increment}`),spans=pdfBaselines(pdf).filter(s=>Math.abs(s.size-9)<.01);
  const screenMax=Math.max(...screen.map(s=>distance(s.y,2.25,increment))),pdfMax=Math.max(...spans.map(s=>distance(s.y,2.25,increment)));
  console.log(`grid ${increment}: screen ${screen.length}/PDF ${spans.length} baseline spans, maximum absolute grid error ${screenMax.toFixed(4)}/${pdfMax.toFixed(4)}pt`);
  expect(screen.length).toBeGreaterThan(40);expect(spans.length).toBe(screen.length);
  expect(screenMax).toBeLessThanOrEqual(.1);expect(pdfMax).toBeLessThanOrEqual(.1);
  const doc=await getDocument(page);expect(doc.stories.story_t1.doc.content[0].attrs.overrides.print.leading).toBe(12);
  if(increment===12) {await snap(page,'baseline-grid',{testInfo:info});await page.getByTestId('grid-start').fill('3');await page.getByTestId('grid-start').press('Enter');expect((await getDocument(page)).baselineGrid.start).toBe(3);}
});
test('grid pads fresh paragraphs and rounds each paragraph leading independently across the thread',async({galley})=>{
  const {page}=galley;await textFixture(page,true,800);
  await page.evaluate(()=>{
    const g=(window as any).__galley,s=g.store.getState(),p=s.history.doc.stories.story_t1.doc.content[0];
    s.dispatch(g.model.setBaselineGrid,{start:1.3,increment:13.5});
    s.dispatch(g.model.setStoryDoc,{storyId:'story_t1',doc:{type:'doc',content:[9,11].map((fontSize,i)=>({...p,attrs:{...p.attrs,overrides:{print:{fontSize,leading:i?14.5:12,spaceBefore:7.25,spaceAfter:4.5,hyphenate:false,alignToBaselineGrid:true}}},content:[{type:'text',text:Array.from({length:400},(_,n)=>'word'+(n+i*400)).join(' ')}]}))}});
  });
  await page.waitForSelector('.galley-page[data-ready=true]');
  const screen=await page.evaluate(screenBaselines),spans=pdfBaselines(await rawPdf(galley,'grid-two-paragraphs'));
  expect(screen.length).toBeGreaterThan(40);expect(spans.length).toBe(screen.length);
  expect(Math.max(...screen.map(s=>distance(s.y,1.3,13.5)))).toBeLessThanOrEqual(.1);
  expect(Math.max(...spans.map(s=>distance(s.y,1.3,13.5)))).toBeLessThanOrEqual(.1);
});
