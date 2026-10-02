import { paragraphAttrs,resolveParagraph,resolveRun,type GalleyDocument,type TextFrame,type PMNode } from '@galley/model';
import { memo } from 'react';
import { htmlFrameStyle,pt } from '../geometry';
import type { ColorResolver } from '../color';
import { paragraphCss,paragraphLanguage,runCss } from '../styles/resolve';
import type { StoryLayout } from './layout';
import {layoutParagraph,paragraphViewCss} from './paragraph';
import {dropCapCss,splitDropCapRuns} from '../styles/dropcaps';

export const ThreadTextFrameView=memo(function ThreadTextFrameView({frame,layout,origin,storyId,doc,colors}:{frame:TextFrame;layout?:StoryLayout;origin:{x:number;y:number};storyId:string;doc:GalleyDocument;colors:ColorResolver}) {
  const story=doc.stories[storyId]!;
  // Server-rendered/a11y fallback is the source story in its first frame; browser layout replaces it before ready.
  const node=layout?.frameNodes.get(frame.id);
  const paragraphs=(node ? node.toJSON().content ?? [] : story.frameIds[0]===frame.id ? story.doc.content ?? [] : []) as PMNode[];
  const r=layout?.result;
  const k=layout?.slots.findIndex(s=>s.frame===frame.id) ?? -1;
  const scale=layout?.scale ?? 1;
  const content=paragraphs.map((p,i)=>{
    const attrs=paragraphAttrs(p);
    const resolved=layoutParagraph(doc,p,doc.baselineGrid);
    const cont=p.attrs?.cont;
    const tail=p.attrs?.tail;
    const css=paragraphViewCss(resolved,colors,p,i===0);
    const draw=(nodes:readonly PMNode[],initial=false)=>nodes.map((t,j)=>{
      const r=resolveRun(doc,resolved,t.marks);
      const style=runCss(resolved,r,colors);
      if(initial) {delete style.fontSize;delete style.lineHeight;delete style.verticalAlign;delete style.position;delete style.top;}
      const text=t.text ?? '';
      const n=tail && j===nodes.length-1 ? text.length-text.replace(/ +$/,'').length : 0;
      return <span key={j} lang={r.language!==resolved.language?r.language:undefined} style={Object.keys(style).length?style:undefined}>{n ? <>{text.slice(0,-n)}<span className="hang">{text.slice(-n)}</span></> : text}</span>;
    });
    const split=resolved.dropCapLines>0 && resolved.dropCapChars>1?splitDropCapRuns(p.content ?? [],resolved.dropCapChars):null;
    const runs=split?<><span data-drop-cap={resolved.dropCapChars} style={dropCapCss(resolved)}>{draw(split.initial,true)}</span>{draw(split.rest)}</>:draw(p.content ?? []);
    return <p key={`${i}:${resolved.dropCapLines}:${resolved.dropCapChars}`} className={[cont?'cont':'',tail].filter(Boolean).join(' ')} lang={paragraphLanguage(resolved)} style={css} data-paragraph-style={attrs.style} data-style={attrs.style}>{p.content?.length?runs:<br/>}</p>;
  });
  return <div className="galley-text" style={htmlFrameStyle(frame,origin)} data-frame-id={frame.id} data-frame-type="text" data-story-id={storyId} data-overset-words={r?.overset && k===r.slots.length-1?r.overset.words:0} data-story-start={r?.slots[k]?.start} data-story-end={r?.slots[k]?.end}>
    <div className={`galley-text-slot${frame.inset>0?' galley-text-inset':''}`} style={{position:'relative',width:pt(Math.max(0,frame.w-2*frame.inset)),zoom:scale===1?undefined:scale,transformOrigin:scale===1?undefined:'0 0',transform:scale!==1?`translate(${pt(frame.inset/scale)}, ${pt(frame.inset/scale)}) scale(${1/scale})`:frame.inset>0?`translate(${pt(frame.inset)}, ${pt(frame.inset)})`:undefined}}>{content}</div>
  </div>;
});
