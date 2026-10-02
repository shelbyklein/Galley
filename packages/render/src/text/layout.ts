import { pageIdOf, type GalleyDocument, type Story } from '@galley/model';
import { type Node, type Schema } from 'prosemirror-model';
import { useLayoutEffect, useRef, useState } from 'react';
import type { ColorResolver } from '../color';
import { createTextSchema } from './schema';
import { Measurer } from './measure';
import { indexOf } from './storyindex';
import { threadStory, type ThreadResult } from './thread';
import { buildViewDoc, diffRegion } from './viewdoc';
import type { Slot } from './slots';
import './text.css';

export interface StoryLayout { story: Node; schema: Schema; slots: Slot[]; result: ThreadResult; view: Node; frameNodes: Map<string, Node> }
export function storySlots(doc: GalleyDocument, story: Story): Slot[] {
  return story.frameIds.flatMap((id, idx) => {
    const f = doc.frames[id];
    if (!f || f.type !== 'text') return [];
    return [{idx,frame:id,col:0,x:f.x+f.inset,y:f.y+f.inset,w:Math.max(0,f.w-2*f.inset),h:Math.max(0,f.h-2*f.inset),wraps:[]}];
  });
}
export function layoutStory(doc: GalleyDocument, story: Story, colors: ColorResolver, previous?: StoryLayout): StoryLayout {
  const slots = storySlots(doc, story);
  const sameGeometry = previous && JSON.stringify(previous.slots) === JSON.stringify(slots);
  const schema = sameGeometry ? previous.schema : createTextSchema(doc, colors, slots);
  const node = schema.nodeFromJSON(story.doc);
  const measurer = new Measurer(schema);
  try {
    const idx = indexOf(node);
    const edit = previous && sameGeometry ? diffRegion(previous.story, node) : null;
    const result = threadStory({doc:node,idx,slots,measurer,prev:edit ? previous?.result : null,edit});
    const view = buildViewDoc({doc:node,idx,res:result,slots,prev:edit && previous ? {view:previous.view,res:previous.result,edit} : null}).doc;
    const frameNodes = new Map<string, Node>();
    slots.forEach((s,k) => frameNodes.set(s.frame,view.child(k)));
    return {story:node,schema,slots,result,view,frameNodes};
  } finally { measurer.dispose(); }
}
export function useStoryLayouts(doc: GalleyDocument, pageId: string, colors: ColorResolver, resourcesReady: boolean) {
  const cache = useRef<{tables: unknown[]; layouts: Map<string, StoryLayout>} | null>(null);
  const [state,setState] = useState<{doc:GalleyDocument;colors:ColorResolver;pageId:string;layouts:Map<string,StoryLayout>} | null>(null);
  useLayoutEffect(() => {
    if (!resourcesReady) return;
    const tables = [doc.paragraphStyles,doc.characterStyles,colors];
    const reuse = cache.current?.tables.every((t,i) => t === tables[i]);
    const layouts = new Map<string, StoryLayout>();
    for (const story of Object.values(doc.stories)) {
      if (!story.frameIds.some(id => pageIdOf(doc,id) === pageId)) continue;
      layouts.set(story.id,layoutStory(doc,story,colors,reuse ? cache.current?.layouts.get(story.id) : undefined));
    }
    cache.current = {tables,layouts};
    setState({doc,colors,pageId,layouts});
  },[doc,pageId,colors,resourcesReady]);
  return {layouts:state?.layouts ?? new Map<string,StoryLayout>(),ready:!!state && state.doc===doc && state.colors===colors && state.pageId===pageId};
}
