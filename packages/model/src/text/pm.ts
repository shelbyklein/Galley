/**
 * ProseMirror JSON shapes, without a ProseMirror dependency. The node and mark objects follow `Node.toJSON()` exactly, so
 * `schema.nodeFromJSON(story.doc)` works with any ProseMirror schema that declares the story's nodes and marks (./story.ts).
 */
export type JSONValue = string | number | boolean | null | JSONValue[] | { [key: string]: JSONValue };

export interface PMMark {
  type: string;
  attrs?: Record<string, JSONValue>;
}

export interface PMNode {
  type: string;
  attrs?: Record<string, JSONValue>;
  content?: PMNode[];
  marks?: PMMark[];
  text?: string;
}
