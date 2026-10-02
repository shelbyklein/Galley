import {normalizeNativeStoryDoc,paragraphAttrs,resolveRun,type PMNode} from '@galley/model';
import type {Node} from 'prosemirror-model';
import {resolvedParagraphOf,textContext} from './schema';
import {runCss,toCssText} from '../styles/resolve';
/** Resolve all of a run's marks against its actual paragraph, including explicit resets to normal/black/zero. */
export function textRunStyle(paragraph:Node,text:Node) {
  const ctx=textContext(paragraph.type.schema),base=resolvedParagraphOf(paragraph);
  const canonical=normalizeNativeStoryDoc({type:'doc',content:[{type:'paragraph',attrs:(paragraph.toJSON() as PMNode).attrs,content:[text.toJSON() as PMNode]}]},ctx.tables);
  const r=resolveRun(ctx.tables,base,canonical.content?.[0]?.content?.[0]?.marks);
  return {css:runCss(base,r,ctx.colors),language:r.language!==base.language?r.language:undefined};
}
export function applyRunDOM(p:HTMLElement,paragraph:Node) {
  const walker=p.ownerDocument.createTreeWalker(p,4),texts:Text[]=[];
  for(let n=walker.nextNode();n;n=walker.nextNode())texts.push(n as Text);
  paragraph.forEach((t,_off,i)=>{
    const node=texts[i];if(!node) return;
    const r=textRunStyle(paragraph,t),style=toCssText(r.css);
    if(!style && !r.language) return;
    const span=p.ownerDocument.createElement('span');if(style)span.style.cssText=style;if(r.language)span.lang=r.language;
    node.replaceWith(span);span.appendChild(node);
  });
}
