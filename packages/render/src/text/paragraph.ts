import {paragraphAttrs,resolveParagraph,type GalleyDocument,type PMNode,type ResolvedParagraph,type StyleTables} from '@galley/model';
import type {ColorResolver} from '../color';
import {paragraphCss} from '../styles/resolve';
import {pt} from '../geometry';
/** Grid alignment is a derived layout value; the user's leading remains unchanged in the story. */
export function layoutParagraph(tables:StyleTables,paragraph:PMNode,grid?:GalleyDocument['baselineGrid']):ResolvedParagraph {
  const r=resolveParagraph(tables,paragraphAttrs(paragraph));
  const leading=r.alignToBaselineGrid && grid?Math.ceil(r.leading/grid.increment-1e-9)*grid.increment:r.leading;
  return leading!==r.leading || paragraph.attrs?.cont?{...r,leading,dropCapLines:paragraph.attrs?.cont?0:r.dropCapLines}:r;
}
export function paragraphViewCss(r:ResolvedParagraph,colors:ColorResolver,p:PMNode,first=false) {
  const cont=!!p.attrs?.cont,pad=Number(p.attrs?.gridPad ?? 0);
  const css=paragraphCss(r,colors,{dropSpaceBefore:first||cont});
  if(cont) css.textIndent='0';
  if(p.attrs?.tail && r.align==='justify') css.textAlignLast='justify';
  if(pad) {
    (css as Record<string,string>)['--galley-grid-pad']=pt(pad);
    css.paddingTop=pt((first||cont?0:r.spaceBefore)+pad);
  }
  return css;
}
