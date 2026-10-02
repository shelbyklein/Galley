import {setFrameProps,wrapOf,type TextWrap} from '@galley/model';
import {Panel} from '../Panel';
import {selectDoc,useEditorStore} from '../../store';
import {isSelectable,leafFrames} from '../../tools/selection-model';
import {Field} from '../../shell/control-strip/Field';
import {formatLength,parseLength} from '../../shell/control-strip/units';
import './wrap.css';
const sides=['top','right','bottom','left'] as const;
type Side=typeof sides[number];
const offsets=(w:TextWrap)=>w.mode==='boundingBox'?w.offsets:{top:w.mode==='contour'?w.offset:12,right:w.mode==='contour'?w.offset:12,bottom:w.mode==='contour'?w.offset:12,left:w.mode==='contour'?w.offset:12};
export function TextWrapPanel() {
  const doc=useEditorStore(selectDoc),selection=useEditorStore(s=>s.selection);
  const frames=leafFrames(doc,selection).filter(f=>isSelectable(doc,f.id)),wraps=frames.map(wrapOf);
  const mode=wraps.every(w=>w.mode===wraps[0]?.mode)?wraps[0]?.mode ?? 'none':'';
  const apply=(make:(w:TextWrap)=>TextWrap)=>{
    const s=useEditorStore.getState();s.closeCoalescing();s.beginTransaction('Text Wrap');
    try {frames.forEach(f=>useEditorStore.getState().dispatch(setFrameProps,{ids:[f.id],props:{textWrap:make(wrapOf(f))}}));}
    finally {useEditorStore.getState().commitTransaction();}
  };
  const change=(next:TextWrap['mode'])=>apply(w=>next==='none'?{mode:'none'}:next==='boundingBox'?{mode:next,offsets:offsets(w)}:{mode:next,offset:Math.max(...Object.values(offsets(w)))});
  const value=(side:Side)=>{
    const n=wraps.map(w=>offsets(w)[side]);return n.length && n.every(v=>v===n[0])?formatLength(n[0]!):'';
  };
  const field=(side:Side,label:string)=><Field key={side} name={`wrap-offset-${side}`} label={label} value={value(side)} disabled={!frames.length || mode==='none' || mode===''} onCommit={text=>{
    const n=parseLength(text);if(n===null || n<0)return false;
    apply(w=>w.mode==='contour'?{mode:'contour',offset:n}:{mode:'boundingBox',offsets:{...offsets(w),[side]:n}});return true;
  }} onStep={(direction,big)=>apply(w=>w.mode==='contour'?{mode:'contour',offset:Math.max(0,w.offset+direction*(big?10:1))}:{mode:'boundingBox',offsets:{...offsets(w),[side]:Math.max(0,offsets(w)[side]+direction*(big?10:1))}})}/>;
  return <Panel id="textWrap"><div className="gl-wrap-controls" data-testid="text-wrap-panel">
    <label>Wrap <select data-testid="wrap-mode" aria-label="Text wrap mode" disabled={!frames.length} value={mode} onChange={e=>change(e.target.value as TextWrap['mode'])}>
      <option value="" disabled>Mixed</option><option value="none">None</option><option value="boundingBox">Bounding box</option><option value="contour">Object contour</option>
    </select></label>
    <div className="gl-wrap-offsets">{mode==='contour'?field('top','Offset'):sides.map(s=>field(s,s[0]!.toUpperCase()+s.slice(1)))}</div>
    <p className="gl-panel-note">Text flows on one side of each object. Contour follows ellipses; other objects use their bounding box.</p>
    {!frames.length && <p className="gl-panel-note">Select an object to change its wrap.</p>}
  </div></Panel>;
}
