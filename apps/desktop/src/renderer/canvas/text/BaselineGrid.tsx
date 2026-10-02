import {setBaselineGrid,type Id} from '@galley/model';
import {useEffect,useState} from 'react';
import {selectDoc,useEditorStore} from '../../store';
import {pageToView,type ViewTransform} from '../viewport';
import './grid.css';
export function BaselineGrid({pageId,view}:{pageId:Id;view:ViewTransform}) {
  const doc=useEditorStore(selectDoc),show=useEditorStore(s=>s.view.baselineGridVisible);
  const grid=doc.baselineGrid,page=doc.pages[pageId]!;
  const [start,setStart]=useState(String(grid.start)),[increment,setIncrement]=useState(String(grid.increment));
  useEffect(()=>{setStart(String(grid.start));setIncrement(String(grid.increment));},[grid]);
  if(!show) return null;
  const commit=()=>{
    const a=Number(start),b=Number(increment);
    if(Number.isFinite(a)&&Number.isFinite(b)&&b>0) useEditorStore.getState().dispatch(setBaselineGrid,{start:a,increment:b});
    else {setStart(String(grid.start));setIncrement(String(grid.increment));}
  };
  const x=pageToView(view,{x:0,y:0}).x;
  const n0=Math.max(0,Math.ceil(-grid.start/grid.increment)),n1=Math.floor((page.height-grid.start)/grid.increment);
  const stride=Math.max(1,Math.ceil(3/(grid.increment*view.zoom)));
  return <>
    <div className="gl-baseline-grid" data-testid="baseline-grid">{Array.from({length:Math.max(0,Math.floor((n1-n0)/stride)+1)},(_,i)=>{const y=grid.start+(n0+i*stride)*grid.increment;return <div key={i} data-grid-y={y} style={{left:x,top:pageToView(view,{x:0,y}).y,width:page.width*view.zoom}}/>;})}</div>
    <div className="gl-grid-controls" data-testid="baseline-grid-controls" onPointerDown={e=>e.stopPropagation()}>
      <span>Baseline grid</span>
      <label>Start <input data-testid="grid-start" aria-label="Grid start" value={start} onChange={e=>setStart(e.target.value)} onBlur={commit} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();e.currentTarget.blur();}}}/><span>pt</span></label>
      <label>Every <input data-testid="grid-increment" aria-label="Grid increment" value={increment} onChange={e=>setIncrement(e.target.value)} onBlur={commit} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();e.currentTarget.blur();}}}/><span>pt</span></label>
    </div>
  </>;
}
