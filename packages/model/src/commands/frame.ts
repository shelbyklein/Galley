import type { Id } from '../ids';
import { parentOf, pageIdOf, subtreeIds } from '../queries';
import { frameSchema, isBoxFrame, type Frame, type GroupFrame, type ImageContent } from '../schema';
import type { Paint, Stroke } from '../swatch';
import { storyDocReferenceProblem, storySchema, type Story } from '../text/story';
import { textWrapSchema, type TextWrap } from '../text/wrap';
import { fail, defineCommand } from './types';
import { assertFinite, baseOf, containerOf, deleteFrameTrees, frameOf, insertAt, layerOf, own, pageOf, removeFrom } from './util';

// ------------------------------------------------------------------------------------------------------------ add

export interface AddFrameArgs {
  frame: Frame;
  pageId: Id;
  /** Put the frame inside this group instead of directly on the page. The group must be on `pageId` and share the layer. */
  parentId?: Id | null;
  /** Position in the container's stacking list; default the top. */
  index?: number;
  /**
   * Required for a text frame: its story (`story.id === frame.storyId`), which must not exist yet. The story's thread starts
   * as this frame (leave `story.frameIds` empty, or `[frame.id]`); join frames to a thread with `thread.link`.
   * Not allowed for other types.
   */
  story?: Story;
}

/** Add a frame (and, for a text frame, its new story) to a page or a group. Groups are made with `frame.group`, so a new group must be empty. */
export const addFrame = defineCommand<AddFrameArgs>('frame.add', 'Add Frame', (d, { frame, pageId, parentId = null, index, story }) => {
  const parsed = frameSchema.safeParse(frame);
  if (!parsed.success) fail(`Invalid frame: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  if (d.frames[frame.id]) fail(`Frame "${frame.id}" already exists`);
  const page = pageOf(d, pageId);
  layerOf(d, frame.layerId);

  if (isBoxFrame(frame)) {
    for (const paint of [frame.fill, frame.stroke?.paint]) {
      if (paint && !d.swatches[paint.swatchId]) fail(`No swatch "${paint.swatchId}"`);
    }
  }
  if (frame.type === 'group' && frame.childIds.length > 0) fail('A new group must be empty; use frame.group to group existing frames');
  if (frame.type === 'text') {
    if (!story || story.id !== frame.storyId) fail(`A text frame needs its story (id "${frame.storyId}")`);
    const s = storySchema.safeParse(story);
    if (!s.success) fail(`Invalid story: ${s.error.issues.map((i) => i.message).join('; ')}`);
    if (d.stories[story.id]) fail(`Story "${story.id}" already exists`);
    if (story.frameIds.length > 0 && !(story.frameIds.length === 1 && story.frameIds[0] === frame.id)) {
      fail('A story is added with its first frame only; thread more frames with thread.link');
    }
    const refProblem = storyDocReferenceProblem(story.doc, d);
    if (refProblem) fail(`Invalid story: ${refProblem}`);
  } else if (story) {
    fail('Only a text frame takes a story');
  }
  if (frame.type === 'image' && frame.assetId !== null && !d.assets[frame.assetId]) fail(`No asset "${frame.assetId}"`);

  let list: Id[];
  if (parentId) {
    const parent = d.frames[parentId];
    if (parent?.type !== 'group') fail(`"${parentId}" is not a group`);
    if (parent.layerId !== frame.layerId) fail('A frame must be on the same layer as its group');
    if (pageIdOf(baseOf(d), parentId) !== pageId) fail(`Group "${parentId}" is not on page "${pageId}"`);
    list = parent.childIds;
  } else {
    list = page.items;
  }
  insertAt(list, frame.id, index);
  d.frames[frame.id] = own(frame);
  if (frame.type === 'text' && story) d.stories[story.id] = own({ ...story, frameIds: [frame.id] });
});

// --------------------------------------------------------------------------------------------------------- remove

/** Delete frames with their children and stories. A group left empty is deleted too. */
export const removeFrames = defineCommand<{ ids: Id[] }>('frame.remove', 'Delete', (d, { ids }) => {
  if (ids.length === 0) fail('Nothing to delete');
  deleteFrameTrees(d, ids);
});

// ----------------------------------------------------------------------------------------------------- properties

/** The properties `frame.setProps` can change. Which ones apply depends on the frame type; others are rejected. */
export interface FrameProps {
  name?: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  rotation?: number;
  fill?: Paint | null;
  stroke?: Stroke | null;
  /** Text frames. */
  inset?: number;
  /** Any box frame: how text in other frames flows around it. `null` or `{ mode: 'none' }` clears it. */
  textWrap?: TextWrap | null;
  /** Image frames; set `assetId` and `content` together. */
  assetId?: Id | null;
  content?: ImageContent | null;
}

const BOX_KEYS = ['x', 'y', 'w', 'h', 'rotation', 'fill', 'stroke'] as const;

/** Set properties on one or more frames in a single step (the control strip fields, the Layers panel rename, ...). */
export const setFrameProps = defineCommand<{ ids: Id[]; props: FrameProps }>('frame.setProps', 'Change Object', (d, { ids, props }) => {
  const keys = Object.keys(props) as (keyof FrameProps)[];
  if (ids.length === 0 || keys.length === 0) return;
  for (const k of ['x', 'y', 'w', 'h', 'rotation', 'inset'] as const) {
    if (props[k] !== undefined) assertFinite(props[k]!, k);
  }
  if (props.w !== undefined && props.w < 0) fail('w cannot be negative');
  if (props.h !== undefined && props.h < 0) fail('h cannot be negative');
  if (props.inset !== undefined && props.inset < 0) fail('inset cannot be negative');
  if (props.stroke && (!Number.isFinite(props.stroke.weight) || props.stroke.weight < 0)) fail('stroke weight must be a non-negative number');
  for (const paint of [props.fill, props.stroke?.paint]) {
    if (paint && !d.swatches[paint.swatchId]) fail(`No swatch "${paint.swatchId}"`);
  }
  if (props.assetId) if (!d.assets[props.assetId]) fail(`No asset "${props.assetId}"`);
  if (props.content && !(props.content.w > 0 && props.content.h > 0)) fail('content size must be positive');
  if (props.textWrap) {
    const r = textWrapSchema.safeParse(props.textWrap);
    if (!r.success) fail(`Invalid text wrap: ${r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  }

  for (const id of ids) {
    const f = frameOf(d, id);
    for (const k of keys) {
      const v = props[k];
      if (v === undefined) continue;
      if (k === 'name') f.name = v as string;
      else if ((BOX_KEYS as readonly string[]).includes(k)) {
        if (f.type === 'group') fail('A group has no box of its own; move or resize its children');
        (f as unknown as Record<string, unknown>)[k] = own(v);
      } else if (k === 'textWrap') {
        if (f.type === 'group') fail('A group has no text wrap; set it on its children');
        if (v === null || (v as TextWrap).mode === 'none') delete f.textWrap;
        else f.textWrap = own(v as TextWrap);
      } else if (k === 'inset') {
        if (f.type !== 'text') fail('inset applies to text frames only');
        f.inset = v as number;
      } else if (k === 'assetId' || k === 'content') {
        if (f.type !== 'image') fail(`${k} applies to image frames only`);
        (f as unknown as Record<string, unknown>)[k] = own(v);
      }
    }
    if (f.type === 'image' && (f.assetId === null) !== (f.content === null)) {
      fail('assetId and content must both be set or both be null');
    }
  }
});

/**
 * Move frames by (dx, dy) points. A group moves all its descendants. If a frame and one of its ancestors are both
 * listed, it still moves once. This is the command a drag issues on every pointer move, inside one transaction.
 */
export const moveFrames = defineCommand<{ ids: Id[]; dx: number; dy: number }>('frame.move', 'Move', (d, { ids, dx, dy }) => {
  assertFinite(dx, 'dx');
  assertFinite(dy, 'dy');
  const base = baseOf(d);
  for (const id of ids) frameOf(d, id);
  if (dx === 0 && dy === 0) return;
  const moved = new Set<Id>();
  for (const id of ids) {
    for (const sub of subtreeIds(base, id)) {
      if (moved.has(sub)) continue;
      moved.add(sub);
      const f = d.frames[sub]!;
      if (f.type !== 'group') {
        f.x += dx;
        f.y += dy;
      }
    }
  }
});

// -------------------------------------------------------------------------------------------------- stacking order

export type ReorderOp = 'front' | 'back' | 'forward' | 'backward';

/**
 * Arrange (Bring to Front, Send to Back, Bring Forward, Send Backward). Frames move within their own container
 * (a page or a group); forward/backward step over the next frame on the same layer, since layers sort first.
 */
export const reorderFrames = defineCommand<{ ids: Id[]; op: ReorderOp }>('frame.reorder', 'Arrange', (d, { ids, op }) => {
  const base = baseOf(d);
  for (const id of ids) frameOf(d, id);
  const byContainer = new Map<string, { list: Id[]; sel: Set<Id> }>();
  for (const id of ids) {
    const key = parentOf(base, id) ?? `page:${pageIdOf(base, id)}`;
    let entry = byContainer.get(key);
    if (!entry) {
      entry = { list: containerOf(d, base, id), sel: new Set() };
      byContainer.set(key, entry);
    }
    entry.sel.add(id);
  }
  for (const { list, sel } of byContainer.values()) {
    const arr = [...list];
    const layerOfId = (id: Id) => base.frames[id]!.layerId;
    if (op === 'front') {
      const next = [...arr.filter((id) => !sel.has(id)), ...arr.filter((id) => sel.has(id))];
      arr.splice(0, arr.length, ...next);
    } else if (op === 'back') {
      const next = [...arr.filter((id) => sel.has(id)), ...arr.filter((id) => !sel.has(id))];
      arr.splice(0, arr.length, ...next);
    } else if (op === 'forward') {
      for (const id of arr.filter((x) => sel.has(x)).reverse()) {
        const i = arr.indexOf(id);
        let j = i + 1;
        while (j < arr.length && (layerOfId(arr[j]!) !== layerOfId(id) || sel.has(arr[j]!))) j++;
        if (j < arr.length) {
          arr.splice(i, 1);
          arr.splice(j, 0, id);
        }
      }
    } else {
      for (const id of arr.filter((x) => sel.has(x))) {
        const i = arr.indexOf(id);
        let j = i - 1;
        while (j >= 0 && (layerOfId(arr[j]!) !== layerOfId(id) || sel.has(arr[j]!))) j--;
        if (j >= 0) {
          arr.splice(i, 1);
          arr.splice(j, 0, id);
        }
      }
    }
    list.splice(0, list.length, ...arr);
  }
});

// ----------------------------------------------------------------------------------------------------------- groups

/**
 * Group frames. They must share one container (same page, same parent group). The group takes the stacking position of
 * the topmost member and the topmost member's layer (InDesign moves the others to it), keeping the members' order.
 */
export const groupFrames = defineCommand<{ ids: Id[]; groupId: Id; name?: string }>('frame.group', 'Group', (d, { ids, groupId, name = '' }) => {
  if (ids.length === 0) fail('Nothing to group');
  if (d.frames[groupId]) fail(`Frame "${groupId}" already exists`);
  const base = baseOf(d);
  const set = new Set(ids);
  if (set.size !== ids.length) fail('Duplicate ids');
  for (const id of ids) frameOf(d, id);
  const parent = parentOf(base, ids[0]!);
  const pageId = pageIdOf(base, ids[0]!);
  for (const id of ids) {
    if (parentOf(base, id) !== parent || pageIdOf(base, id) !== pageId) fail('Frames to group must be in the same container');
  }
  const list = containerOf(d, base, ids[0]!);
  const ordered = list.filter((id) => set.has(id));
  const topIndex = list.lastIndexOf(ordered[ordered.length - 1]!);

  // the group's layer is the topmost layer among the members
  const rank = new Map(base.layerOrder.map((id, i) => [id, i]));
  let layerId = base.frames[ordered[0]!]!.layerId;
  for (const id of ordered) {
    const l = base.frames[id]!.layerId;
    if (rank.get(l)! >= rank.get(layerId)!) layerId = l;
  }
  for (const id of ordered) for (const sub of subtreeIds(base, id)) d.frames[sub]!.layerId = layerId;

  const group: GroupFrame = { id: groupId, type: 'group', name, layerId, childIds: ordered };
  const next: Id[] = [];
  list.forEach((id, i) => {
    if (i === topIndex) next.push(groupId);
    else if (!set.has(id)) next.push(id);
  });
  list.splice(0, list.length, ...next);
  d.frames[groupId] = group;
});

/** Dissolve groups: each group's children take its place in the stacking order. */
export const ungroupFrames = defineCommand<{ ids: Id[] }>('frame.ungroup', 'Ungroup', (d, { ids }) => {
  if (ids.length === 0) fail('Nothing to ungroup');
  const base = baseOf(d);
  for (const id of ids) {
    const g = frameOf(d, id);
    if (g.type !== 'group') fail(`Frame "${id}" is not a group`);
  }
  // Resolve each group's container from the starting document, but splice into the live draft lists.
  for (const id of ids) {
    const g = d.frames[id];
    if (g?.type !== 'group') fail(`Frame "${id}" is not a group`);
    const list = containerOfLive(d, base, id);
    const at = list.indexOf(id);
    list.splice(at, 1, ...g.childIds);
    delete d.frames[id];
  }
});

/** Like containerOf, but follows groups that earlier steps of the same command already dissolved. */
function containerOfLive(d: Parameters<typeof containerOf>[0], base: Parameters<typeof containerOf>[1], id: Id): Id[] {
  let parent = parentOf(base, id);
  while (parent && !d.frames[parent]) parent = parentOf(base, parent);
  if (parent) {
    const g = d.frames[parent];
    if (g?.type !== 'group') fail(`Frame "${parent}" is not a group`);
    return g.childIds;
  }
  const pageId = pageIdOf(base, id);
  if (!pageId) fail(`Frame "${id}" is not on any page`);
  return pageOf(d, pageId).items;
}

// ---------------------------------------------------------------------------------------------- layer and page moves

/** Move top-level frames (with their children) to another layer. A group's children cannot change layer on their own. */
export const moveFramesToLayer = defineCommand<{ ids: Id[]; layerId: Id }>('frame.moveToLayer', 'Move to Layer', (d, { ids, layerId }) => {
  layerOf(d, layerId);
  const base = baseOf(d);
  for (const id of ids) {
    frameOf(d, id);
    if (parentOf(base, id) !== null) fail(`Frame "${id}" is inside a group; move the group instead`);
  }
  for (const id of ids) for (const sub of subtreeIds(base, id)) d.frames[sub]!.layerId = layerId;
});

/** Move top-level frames to another page, optionally shifting them by (dx, dy) so they keep their place on the pasteboard. */
export const moveFramesToPage = defineCommand<{ ids: Id[]; pageId: Id; dx?: number; dy?: number }>('frame.moveToPage', 'Move to Page', (d, { ids, pageId, dx = 0, dy = 0 }) => {
  assertFinite(dx, 'dx');
  assertFinite(dy, 'dy');
  const target = pageOf(d, pageId);
  const base = baseOf(d);
  for (const id of ids) {
    frameOf(d, id);
    if (parentOf(base, id) !== null) fail(`Frame "${id}" is inside a group; move the group instead`);
  }
  const sourcePage = (id: Id) => pageIdOf(base, id)!;
  const ordered = [...ids].sort((a, b) => {
    const pa = sourcePage(a);
    const pb = sourcePage(b);
    if (pa !== pb) return base.pageOrder.indexOf(pa) - base.pageOrder.indexOf(pb);
    return base.pages[pa]!.items.indexOf(a) - base.pages[pb]!.items.indexOf(b);
  });
  for (const id of ordered) {
    if (sourcePage(id) === pageId) continue;
    removeFrom(pageOf(d, sourcePage(id)).items, id);
    target.items.push(id);
  }
  if (dx !== 0 || dy !== 0) {
    for (const id of ordered) {
      for (const sub of subtreeIds(base, id)) {
        const f = d.frames[sub]!;
        if (f.type !== 'group') {
          f.x += dx;
          f.y += dy;
        }
      }
    }
  }
});
