import { patchOverrides,NONE_CHARACTER_ID,type CharacterOverrides,type OverridePatch } from '@galley/model';
import type { StoryEditor } from '@galley/render';
let current:StoryEditor|null=null;
export function activeStoryEditor(){return current;}
export function setActiveStoryEditor(editor:StoryEditor|null){current=editor;if(!editor && typeof window!=='undefined') window.dispatchEvent(new CustomEvent('galley:caret-state',{detail:null}));}
export function reportCaretState(storyId:string) {
  const e=current;if(!e) return;
  const sel=e.storySelection();
  window.dispatchEvent(new CustomEvent('galley:caret-state',{detail:sel.anchor===sel.head?{storyId,position:sel.head,marks:(e.story.storedMarks ?? e.story.selection.$from.marks()).map(m=>m.toJSON())}:null}));
}
export function setCaretOverrides(patch:OverridePatch<CharacterOverrides>):boolean {
  const e=current;if(!e) return false;e.syncStorySelection();if(!e.story.selection.empty) return false;
  const marks=e.story.storedMarks ?? e.story.selection.$from.marks();
  const old=marks.find(m=>m.type.name==='override');
  const next=patchOverrides(old?.attrs as CharacterOverrides|undefined,patch);
  e.setStoredMarks([...marks.filter(m=>m.type.name!=='override'),...(next?[e.schema.marks.override!.create(next)]:[])]);
  return true;
}
export function setCaretCharacterStyle(styleId:string|null):boolean {
  const e=current;if(!e) return false;e.syncStorySelection();if(!e.story.selection.empty) return false;
  const marks=e.story.storedMarks ?? e.story.selection.$from.marks();
  e.setStoredMarks([...marks.filter(m=>m.type.name!=='charStyle'),...(styleId && styleId!==NONE_CHARACTER_ID?[e.schema.marks.charStyle!.create({style:styleId})]:[])]);
  return true;
}

if(typeof window!=='undefined') window.addEventListener('galley:caret-format',event=>{
  const detail=(event as CustomEvent<{kind:'overrides'|'style';patch?:OverridePatch<CharacterOverrides>;styleId?:string|null;handled:boolean}>).detail;
  if(!detail) return;
  detail.handled=detail.kind==='style'?setCaretCharacterStyle(detail.styleId ?? null):!!detail.patch && setCaretOverrides(detail.patch);
});
