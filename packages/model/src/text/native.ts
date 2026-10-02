import { mergeLayerProps,type CharacterOverrides } from './props';
import { resolveParagraph,type StyleTables } from './styles';
import { bolderWeight } from '../migrate/v1';
import { normalizeStoryDoc,paragraphAttrs } from './story';
import type { PMNode } from './pm';
/** Convert browser bold/italic paste and editing marks to the stored v2 override vocabulary. */
export function normalizeNativeStoryDoc(doc:PMNode,tables:StyleTables):PMNode {
  return normalizeStoryDoc({...doc,content:(doc.content ?? []).map(p=>{
    const r=resolveParagraph(tables,paragraphAttrs(p));
    return {...p,content:(p.content ?? []).map(t=>{
      const native:CharacterOverrides['shared']={};
      if(t.marks?.some(m=>m.type==='strong')) native.fontWeight=bolderWeight(r.fontWeight);
      if(t.marks?.some(m=>m.type==='em')) native.fontStyle='italic';
      const existing=t.marks?.find(m=>m.type==='override')?.attrs as CharacterOverrides|undefined;
      const overrides=mergeLayerProps(existing ?? {},Object.keys(native).length?{shared:native}:{});
      const marks=(t.marks ?? []).filter(m=>m.type==='charStyle');
      if(Object.keys(overrides).length) marks.push({type:'override',attrs:overrides as PMNode['attrs']});
      return {...t,marks};
    })};
  })});
}
