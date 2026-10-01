import type { Draft } from 'immer';
import type { GalleyDocument } from '../schema';

/** Thrown by a command that cannot apply (bad arguments, missing object, broken rule). The document is left unchanged. */
export class CommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommandError';
  }
}

export function fail(message: string): never {
  throw new CommandError(message);
}

/** The document as the command's recipe sees it: a mutable Immer draft. */
export type DocDraft = Draft<GalleyDocument>;

/**
 * A command is a named, labelled mutation of the document. `run` mutates the draft in place (Immer turns that into
 * a new immutable document plus patches and inverse patches, which is what undo/redo replays). Rules:
 *   - `run` is deterministic: everything it needs comes from `args` and the draft. Ids are passed in, never generated.
 *   - Validate first, then mutate; throw `CommandError` (via `fail`) to reject. A throw discards all changes.
 *   - Leave the document valid (see validateDocument). The model tests apply every command to random documents and
 *     check this, so a new command must be added to the random-sequence test (test/random-commands.ts).
 *   - Copy objects taken from `args` into the draft with `own()`: Immer freezes whatever is stored in the document.
 */
export interface CommandDef<A> {
  /** Dotted name, `<area>.<verb>`: `frame.move`. Unique across the model. */
  readonly name: string;
  /** Undo menu label: `Move`, `Delete`, `Group`. */
  readonly label: string;
  readonly run: (draft: DocDraft, args: A) => void;
}

export function defineCommand<A>(name: string, label: string, run: (draft: DocDraft, args: A) => void): CommandDef<A> {
  return { name, label, run };
}
