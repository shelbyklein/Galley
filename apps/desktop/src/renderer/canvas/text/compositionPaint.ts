import type {Paint} from '@galley/model';
import type {ColorResolver,StoryEditor} from '@galley/render';

/** Color updates touch inherited variables, never ProseMirror's native composition DOM. */
export function editorInk(el:HTMLElement,initial:ColorResolver) {
  let colors=initial;
  const inks=new Map<string,{paint:Paint;variable:string}>();
  const resolver:ColorResolver={mode:'screen',css(paint){
    if(!paint) return 'transparent';
    const key=JSON.stringify(paint);
    let ink=inks.get(key);
    if(!ink){ink={paint,variable:`--galley-editor-ink-${inks.size}`};inks.set(key,ink);el.style.setProperty(ink.variable,colors.css(paint));}
    // Measurement hosts outside the editor also receive a real color fallback.
    return `var(${ink.variable}, ${colors.css(paint)})`;
  }};
  return {resolver,update(next:ColorResolver){colors=next;for(const ink of inks.values())el.style.setProperty(ink.variable,colors.css(ink.paint));}};
}

/** Keep static layout measurable, swapping only this story's ink during native preedit. */
export function compositionPaint(el:HTMLElement,e:StoryEditor,storyId:string) {
  const page=el.closest('.gl-page-layer')?.querySelector<HTMLElement>('.galley-page');
  const hidden=new Set<HTMLElement>();
  let raf=0,active=false;
  const frames=()=>Array.from(page?.querySelectorAll<HTMLElement>('.galley-text') ?? []).filter(f=>f.dataset.storyId===storyId);
  const hide=()=>{active=true;el.dataset.compositionPaint='';for(const f of frames()){f.dataset.compositionHidden='';hidden.add(f);}};
  const restore=()=>{active=false;delete el.dataset.compositionPaint;for(const f of hidden)delete f.dataset.compositionHidden;hidden.clear();};
  const settled=()=>page?.dataset.ready==='true' && e.slots.every((s,i)=>{
    const f=frames().find(f=>f.dataset.frameId===s.frame);
    return !f || f.textContent===e.vdoc.child(i).textContent;
  });
  const refresh=()=>{
    cancelAnimationFrame(raf);
    if(e.composing || e.pendingRethread){hide();return;}
    if(!active) return;
    // Source/store and static React paint settle after the editor's commit callback.
    raf=requestAnimationFrame(()=>{if(e.composing || e.pendingRethread)hide();else if(settled())restore();else refresh();});
  };
  const start=()=>hide(),end=()=>refresh();
  el.addEventListener('compositionstart',start);el.addEventListener('compositionend',end);
  return {refresh,destroy(){cancelAnimationFrame(raf);el.removeEventListener('compositionstart',start);el.removeEventListener('compositionend',end);restore();}};
}
