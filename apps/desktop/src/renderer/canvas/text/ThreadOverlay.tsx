import { createId,pageIdOf,linkFrames,unlinkFrame,type TextFrame,type Id } from '@galley/model';
import { useEffect,useState } from 'react';
import { selectDoc,useEditorStore } from '../../store';
import { useShellStore } from '../../shell/shellStore';
import { pageToView,viewToPage,type ViewTransform } from '../viewport';
import { isSelectable } from '../../tools/selection-model';
import { hitTest } from '../../tools/hit-test';
import { exitTextEdit } from './TextEditor';
import './threads.css';
export function ThreadOverlay({pageId,view}:{pageId:Id;view:ViewTransform}) {
  const doc=useEditorStore(selectDoc);
  const selected=useEditorStore(s=>s.selection);
  const show=useEditorStore(s=>s.view.textThreadsVisible);
  const [pending,setPending]=useState<string|null>(null);
  const [overset,setOverset]=useState<Record<string,number>>({});
  useEffect(()=>{
    const page=document.querySelector('.galley-page');if(!page) return;
    const read=()=>{const counts:Record<string,number>={};page.querySelectorAll<HTMLElement>('.galley-text[data-frame-id]').forEach(el=>counts[el.dataset.frameId!]=Number(el.dataset.oversetWords ?? 0));setOverset(old=>JSON.stringify(old)===JSON.stringify(counts)?old:counts);};
    read();const observer=new MutationObserver(read);observer.observe(page,{attributes:true,attributeFilter:['data-overset-words'],childList:true,subtree:true});return()=>observer.disconnect();
  },[doc]);
  useEffect(()=>{const escape=(e:KeyboardEvent)=>{if(e.key==='Escape')setPending(null);};window.addEventListener('keydown',escape);return()=>window.removeEventListener('keydown',escape);},[]);
  useEffect(()=>{
    if(!pending) return;
    const click=(event:PointerEvent)=>{
      const target=event.target as HTMLElement;
      if(event.button!==0 || target.closest('[data-text-port]') || !target.closest('.gl-viewport')) return;
      const viewport=target.closest('.gl-viewport')!.getBoundingClientRect();
      const id=hitTest(doc,pageId,viewToPage(view,{x:event.clientX-viewport.left,y:event.clientY-viewport.top}),3/view.zoom);
      const frame=id?doc.frames[id]:null;
      if(frame?.type!=='text') return;
      event.preventDefault();event.stopPropagation();pick(frame,'in',false);
    };
    window.addEventListener('pointerdown',click,true);return()=>window.removeEventListener('pointerdown',click,true);
  },[pending,doc,pageId,view]);
  const frames=Object.values(doc.frames).filter((f):f is TextFrame=>f.type==='text' && pageIdOf(doc,f.id)===pageId && isSelectable(doc,f.id));
  const activeStories=new Set(selected.map(id=>doc.frames[id]).filter((f):f is TextFrame=>f?.type==='text').map(f=>f.storyId));
  const visible=frames.filter(f=>show||pending||activeStories.has(f.storyId));
  const port=(f:TextFrame,end:'in'|'out')=>{
    const local=end==='in'?{x:f.x,y:f.y+8}:{x:f.x+f.w,y:f.y+f.h-8};
    const cx=f.x+f.w/2,cy=f.y+f.h/2,a=f.rotation*Math.PI/180;
    return pageToView(view,{x:cx+(local.x-cx)*Math.cos(a)-(local.y-cy)*Math.sin(a),y:cy+(local.x-cx)*Math.sin(a)+(local.y-cy)*Math.cos(a)});
  };
  const breakAt=(frameId:string)=>{exitTextEdit();useEditorStore.getState().dispatch(unlinkFrame,{frameId,newStoryId:createId('story')});setPending(null);};
  const pick=(f:TextFrame,end:'in'|'out',alt:boolean)=>{
    const chain=doc.stories[f.storyId]!.frameIds,at=chain.indexOf(f.id);
    if(alt || (end==='in' && !pending && at>0)) {if(end==='in' && at>0) breakAt(f.id);else if(end==='out' && at<chain.length-1) breakAt(chain[at+1]!);return;}
    if(pending && pending!==f.id) {
      try {exitTextEdit();useEditorStore.getState().dispatch(linkFrames,{fromId:pending,toId:f.id});setPending(null);}
      catch(error){useShellStore.getState().pushNotice({level:'warning',text:error instanceof Error?error.message:String(error)});}
      return;
    }
    if(end==='out') {if(at<chain.length-1) breakAt(chain[at+1]!);else setPending(f.id);}
  };
  return <div className="gl-thread-overlay" data-testid="text-threads" data-linking-from={pending ?? ''}>
    {show && <div className="gl-thread-lines" data-testid="thread-lines">{frames.flatMap(f=>{const chain=doc.stories[f.storyId]!.frameIds;const next=doc.frames[chain[chain.indexOf(f.id)+1] ?? ''];if(next?.type!=='text'||pageIdOf(doc,next.id)!==pageId)return [];const a=port(f,'out'),b=port(next,'in');return <div className="gl-thread-line" key={f.id} data-thread-from={f.id} data-thread-to={next.id} style={{left:a.x,top:a.y,width:Math.hypot(b.x-a.x,b.y-a.y),transform:`rotate(${Math.atan2(b.y-a.y,b.x-a.x)}rad)`}}/>;})}</div>}
    {visible.flatMap(f=>(['in','out'] as const).map(end=>{const chain=doc.stories[f.storyId]!.frameIds,at=chain.indexOf(f.id),connected=end==='in'?at>0:at<chain.length-1,count=end==='out'?overset[f.id] ?? 0:0,p=port(f,end);return <button key={`${f.id}-${end}`} type="button" className={`gl-text-port${connected?' connected':''}${count?' overset':''}${pending===f.id?' pending':''}`} data-text-port={end} data-frame-id={f.id} data-overset-words={count} aria-label={`${end==='in'?'In':'Out'} port ${f.id}${count?`, ${count} overset words`:''}`} title={connected?'Click to unlink thread':count?`${count} overset words; click to thread`:'Click out port then destination in port'} style={{left:p.x-4,top:p.y-4}} onPointerDown={e=>{e.preventDefault();e.stopPropagation();}} onClick={e=>{e.stopPropagation();pick(f,end,e.altKey);}}>{count?'+':connected?'•':''}</button>;}))}
    {visible.filter(f=>(overset[f.id] ?? 0)>0).map(f=>{const p=port(f,'out');return <span className="gl-overset-count" key={f.id} data-testid="overset-count" data-frame-id={f.id} style={{left:p.x-4,top:p.y+9}}>{overset[f.id]} overset words</span>;})}
    {pending && <div className="gl-thread-hint">Click the next frame’s in-port to thread. Escape cancels.</div>}
  </div>;
}
