import { pageIdOf,setStoryDoc,normalizeNativeStoryDoc,type Id,type PMNode } from '@galley/model';
import { createTextSchema,Measurer,StoryEditor,storySlots,storyTextScale,sheetGeometry,extractLines } from '@galley/render';
import { undoDepth } from 'prosemirror-history';
import { useLayoutEffect,useRef } from 'react';
import { patchCanvasState } from '../canvasState';
import { selectDoc,useEditorStore } from '../../store';
import { reportCaretState,setActiveStoryEditor } from './session';
import './editing.css';
export function exitTextEdit(){patchCanvasState({textEdit:null});setActiveStoryEditor(null);const s=useEditorStore.getState();s.setTextSelection(null);s.closeCoalescing();}
export function TextEditor({frameId,caret}:{frameId:Id;caret:'end'|{clientX:number;clientY:number}}) {
  const doc=useEditorStore(selectDoc);
  const ref=useRef<HTMLDivElement>(null);
  const editor=useRef<StoryEditor|null>(null);
  const shown=useRef<PMNode|null>(null);
  const syncing=useRef(false);
  const saved=useRef<{storyId:string;anchor:number;head:number;focused:boolean}|null>(null);
  const frame=doc.frames[frameId];
  const story=frame?.type==='text'?doc.stories[frame.storyId]:undefined;
  const scale=story?storyTextScale(doc,story):1;
  useLayoutEffect(()=>{
    const el=ref.current;if(!el || !story || !frame || frame.type!=='text') return;
    const geo=sheetGeometry(doc.pages[pageIdOf(doc,frameId)!]!);
    const slots=storySlots(doc,story).map(s=>({...s,x:s.x+geo.origin.x,y:s.y+geo.origin.y}));
    const schema=createTextSchema({...doc,baselineGrid:{...doc.baselineGrid,start:doc.baselineGrid.start+geo.origin.y}},{mode:'screen',css:()=> 'transparent'},slots,scale);
    const measurer=new Measurer(schema);
    const historyAction=(action:'undo'|'redo')=>()=>useEditorStore.getState()[action]();
    const e=new StoryEditor(el,schema.nodeFromJSON(story.doc),slots,measurer,{undo:historyAction('undo'),redo:historyAction('redo'),attributes:{class:'gl-text-editor gl-thread-editor'}});
    editor.current=e;setActiveStoryEditor(e);shown.current=story.doc;
    let depth=undoDepth(e.story);
    e.onUpdate=()=>{
      const s=useEditorStore.getState();
      if(!syncing.current && !e.composing && !e.pendingRethread) {
        const next=normalizeNativeStoryDoc(e.story.doc.toJSON() as PMNode,s.history.doc);
        if(JSON.stringify(next)!==JSON.stringify(shown.current)) {
          const nextDepth=undoDepth(e.story);
          if(nextDepth>depth && depth>0) s.closeCoalescing();
          depth=nextDepth;
          shown.current=next;
          s.dispatch(setStoryDoc,{storyId:story.id,doc:next},{coalesceKey:`edit:${story.id}`,label:'Edit Text'});
        }
      }
      const sel=e.storySelection();s.setTextSelection({storyId:story.id,...sel});
      reportCaretState(story.id);
    };
    el.dataset.testid='text-editor';el.dataset.textEditor='';el.dataset.editingFrame=frameId;
    const previous=saved.current?.storyId===story.id?saved.current:null;
    if(!previous || previous.focused) e.view.focus();
    const slot=slots.findIndex(s=>s.frame===frameId);
    let pos=e.res.slots[slot]?.end ?? 1;
    if(caret!=='end') {
      const hit=e.view.posAtCoords({left:caret.clientX,top:caret.clientY});
      const at=hit && e.view.state.doc.resolve(hit.pos);
      if(at?.parent.isTextblock) pos=e.vmap.viewToStory(hit!.pos);
    }
    e.setStorySelection(previous?.anchor ?? pos,previous?.head ?? pos,slot);e.onUpdate();
    if(window.galley?.e2e) (window as any).__galleyText={editor:e,lines:()=>extractLines(document.querySelector('.galley-page') as HTMLElement,el)};
    return ()=>{saved.current={storyId:story.id,...e.storySelection(),focused:document.activeElement===e.view.dom};e.onUpdate=null;e.destroy();measurer.dispose();editor.current=null;setActiveStoryEditor(null);useEditorStore.getState().setTextSelection(null);if(window.galley?.e2e) delete (window as any).__galleyText;};
  // Rebuild style/geometry DOM while preserving selection. Text edits alone sync below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[frameId,doc.paragraphStyles,doc.characterStyles,doc.frames,doc.baselineGrid,story?.frameIds,scale]);
  useLayoutEffect(()=>{
    const e=editor.current;if(!e || !story || story.doc===shown.current) return;
    if(e.composing) return;
    syncing.current=true;shown.current=story.doc;e.setExternalStory(e.schema.nodeFromJSON(story.doc));syncing.current=false;
  },[story]);
  useLayoutEffect(()=>{if(!story) exitTextEdit();},[story]);
  if(!story) return null;
  return <div ref={ref} data-testid="text-editor" data-text-editor="" className="gl-text-editor gl-thread-editor" onKeyDown={ev=>{if(ev.key==='Escape'){ev.preventDefault();exitTextEdit();}}} />;
}
