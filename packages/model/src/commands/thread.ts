/**
 * Threads: commands that change which frames a story flows through. A story owns the ordered chain of its text frames
 * (`story.frameIds`) and each text frame names its story (`frame.storyId`); every command here updates both sides together and
 * leaves the document valid. Text never moves between frames by itself (that is the thread engine's layout); the commands only
 * decide which frames are windows onto which story.
 *
 *   thread.link     join the thread ending at one frame to the thread starting at another frame (an out-port to an in-port).
 *                   The second story's text follows the first's.
 *   thread.insert   put an empty, unthreaded frame into a thread at a chosen place.
 *   thread.unlink   break a thread before a frame: that frame and the ones after it become a new, empty story. The text all
 *                   stays in the first story (the first frames may now be overset).
 *   thread.remove   take one frame out of its thread; the thread closes up around it and the frame gets a new, empty story.
 *
 * Deleting a text frame (`frame.remove`) also leaves its thread; deleting the last frame of a story deletes the story.
 */
import type { Id } from '../ids';
import type { TextFrame } from '../schema';
import { normalizeStoryDoc, paragraphNode, storyIsEmpty, type Story } from '../text/story';
import type { PMNode } from '../text/pm';
import { defineCommand, fail, type DocDraft } from './types';
import { baseOf, own } from './util';

function textFrameOf(d: DocDraft, id: Id): TextFrame {
  const f = d.frames[id];
  if (!f) fail(`No frame "${id}"`);
  if (f.type !== 'text') fail(`Frame "${id}" is not a text frame`);
  return f as TextFrame;
}

const emptyStory = (id: Id, frameIds: Id[]): Story => ({ id, frameIds, doc: { type: 'doc', content: [paragraphNode()] } as Story['doc'] });

/**
 * Link the thread that ends at `fromId` to the thread that starts at `toId`: the out-port of `fromId` to the in-port of `toId`.
 * `fromId` must be the last frame of its thread and `toId` the first frame of a different thread. The frames of both threads
 * form one thread, in that order, and `toId`'s text is appended to the first story's (an empty second story adds nothing).
 */
export const linkFrames = defineCommand<{ fromId: Id; toId: Id }>('thread.link', 'Thread Text', (d, { fromId, toId }) => {
  const from = textFrameOf(d, fromId);
  const to = textFrameOf(d, toId);
  if (from.storyId === to.storyId) fail('Those frames are already in the same thread');
  const base = baseOf(d);
  const source = base.stories[from.storyId]!;
  const target = base.stories[to.storyId]!;
  if (source.frameIds[source.frameIds.length - 1] !== fromId) fail('The frame already continues into another frame; break its thread first');
  if (target.frameIds[0] !== toId) fail('The frame is already a continuation of another thread; break its thread first');

  // (ids are taken before the frames are re-pointed: `to.storyId` is about to change)
  const sourceId = from.storyId;
  const targetId = to.storyId;
  const merged = d.stories[sourceId]!;
  merged.frameIds = [...source.frameIds, ...target.frameIds];
  if (!storyIsEmpty(target.doc as PMNode)) {
    merged.doc = own(normalizeStoryDoc({ type: 'doc', content: [...((source.doc as PMNode).content ?? []), ...((target.doc as PMNode).content ?? [])] })) as Story['doc'];
  }
  for (const id of target.frameIds) (d.frames[id] as TextFrame).storyId = sourceId;
  delete d.stories[targetId];
});

/**
 * Put an empty, unthreaded text frame into the thread of another frame, `before` or `after` it. `frameId` must be the only frame
 * of its story and that story must hold no text (a frame with text joins a thread with `thread.link`, which appends its text).
 */
export const insertFrameInThread = defineCommand<{ frameId: Id; targetId: Id; position: 'before' | 'after' }>(
  'thread.insert',
  'Insert Frame in Thread',
  (d, { frameId, targetId, position }) => {
    if (position !== 'before' && position !== 'after') fail(`position must be "before" or "after", got ${String(position)}`);
    const frame = textFrameOf(d, frameId);
    const target = textFrameOf(d, targetId);
    if (frame.storyId === target.storyId) fail('The frame is already in that thread');
    const base = baseOf(d);
    const loose = base.stories[frame.storyId]!;
    if (loose.frameIds.length !== 1) fail('The frame is part of a thread; take it out of the thread first');
    if (!storyIsEmpty(loose.doc as PMNode)) fail('Only an empty frame can be inserted into a thread; use thread.link to add a frame that has text');

    const chain = [...base.stories[target.storyId]!.frameIds];
    chain.splice(chain.indexOf(targetId) + (position === 'after' ? 1 : 0), 0, frameId);
    d.stories[target.storyId]!.frameIds = chain;
    frame.storyId = target.storyId;
    delete d.stories[loose.id];
  },
);

/**
 * Break a thread before `frameId`: it and every frame after it move to a new story `newStoryId` (empty, in [Basic Paragraph]),
 * and the first story keeps all the text. `frameId` must not be the first frame of its thread.
 */
export const unlinkFrame = defineCommand<{ frameId: Id; newStoryId: Id }>('thread.unlink', 'Break Thread', (d, { frameId, newStoryId }) => {
  const frame = textFrameOf(d, frameId);
  if (d.stories[newStoryId]) fail(`Story "${newStoryId}" already exists`);
  const story = baseOf(d).stories[frame.storyId]!;
  const at = story.frameIds.indexOf(frameId);
  if (at <= 0) fail(at < 0 ? `Frame "${frameId}" is not in its story's thread` : 'The frame is the first of its thread; there is nothing before it to break from');
  const moved = story.frameIds.slice(at);
  d.stories[story.id]!.frameIds = story.frameIds.slice(0, at);
  d.stories[newStoryId] = emptyStory(newStoryId, moved);
  for (const id of moved) (d.frames[id] as TextFrame).storyId = newStoryId;
});

/**
 * Take one frame out of its thread. The thread closes up around it (the text now flows through one frame fewer) and the frame
 * becomes unthreaded with a new empty story `newStoryId`. The frame must be in a thread of two or more frames.
 */
export const removeFrameFromThread = defineCommand<{ frameId: Id; newStoryId: Id }>('thread.remove', 'Remove from Thread', (d, { frameId, newStoryId }) => {
  const frame = textFrameOf(d, frameId);
  if (d.stories[newStoryId]) fail(`Story "${newStoryId}" already exists`);
  const story = baseOf(d).stories[frame.storyId]!;
  if (!story.frameIds.includes(frameId)) fail(`Frame "${frameId}" is not in its story's thread`);
  if (story.frameIds.length < 2) fail('The frame is not part of a thread');
  d.stories[story.id]!.frameIds = story.frameIds.filter((id) => id !== frameId);
  d.stories[newStoryId] = emptyStory(newStoryId, [frameId]);
  frame.storyId = newStoryId;
});
