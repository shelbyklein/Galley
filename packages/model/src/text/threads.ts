/**
 * Threads: a story owns the ordered chain of its text frames (`story.frameIds`), and each text frame points back at its story
 * (`frame.storyId`). These are the read-only queries; `thread.*` commands change chains (../commands/thread.ts) and the
 * validator keeps the two directions consistent (../validate.ts).
 */
import type { Id } from '../ids';
import type { GalleyDocument, TextFrame } from '../schema';
import type { Story } from './story';

export interface ThreadPosition {
  story: Story;
  /** Where the frame sits in the chain, 0 for the first. */
  index: number;
  /** The frame before it in reading order, or null for the first frame. */
  prev: Id | null;
  /** The frame after it, or null for the last frame. */
  next: Id | null;
}

/** The thread a text frame is in, or null when the id is not a text frame (or its story is missing). */
export function threadPosition(doc: GalleyDocument, frameId: Id): ThreadPosition | null {
  const frame = doc.frames[frameId];
  if (frame?.type !== 'text') return null;
  const story = doc.stories[frame.storyId];
  if (!story) return null;
  const index = story.frameIds.indexOf(frameId);
  if (index < 0) return null;
  return { story, index, prev: index > 0 ? story.frameIds[index - 1]! : null, next: index < story.frameIds.length - 1 ? story.frameIds[index + 1]! : null };
}

/** The text frames of a story in reading order. */
export function threadFrames(doc: GalleyDocument, storyId: Id): TextFrame[] {
  const story = doc.stories[storyId];
  if (!story) return [];
  return story.frameIds.map((id) => doc.frames[id]).filter((f): f is TextFrame => f?.type === 'text');
}

/** Whether the frame is in a thread of two or more frames. */
export function isThreaded(doc: GalleyDocument, frameId: Id): boolean {
  return (threadPosition(doc, frameId)?.story.frameIds.length ?? 0) > 1;
}
