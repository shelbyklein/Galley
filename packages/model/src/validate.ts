/**
 * Integrity checks the schema cannot express: dangling ids, one placement per frame, order arrays that match their
 * records, swatch rules. `validateDocument` returns every problem it finds; `assertValidDocument` throws on the
 * first set. Commands are tested to keep every document valid; the app runs this on open and in dev builds, not on
 * every keystroke.
 */
import type { Id } from './ids';
import type { GalleyDocument } from './schema';
import { storyDocReferenceProblem } from './text/story';
import { BASIC_PARAGRAPH_ID, NONE_CHARACTER_ID } from './text/styles';

export interface ValidationIssue {
  code:
    | 'id-mismatch'
    | 'order-mismatch'
    | 'dangling-id'
    | 'duplicate-placement'
    | 'unreachable-frame'
    | 'group-cycle'
    | 'layer-mismatch'
    | 'swatch-rule'
    | 'story-rule'
    | 'thread-rule'
    | 'style-rule'
    | 'style-cycle'
    | 'duplicate-name';
  message: string;
  /** A readable location such as `frames.frm_1.fill.swatchId`. */
  path: string;
}

export class DocumentValidationError extends Error {
  constructor(readonly issues: ValidationIssue[]) {
    super(`Invalid document: ${issues.slice(0, 5).map((i) => `${i.path}: ${i.message}`).join('; ')}${issues.length > 5 ? ` (+${issues.length - 5} more)` : ''}`);
    this.name = 'DocumentValidationError';
  }
}

export function validateDocument(doc: GalleyDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (code: ValidationIssue['code'], path: string, message: string) => issues.push({ code, path, message });

  // record keys match object ids
  for (const [collection, records] of [
    ['pages', doc.pages],
    ['layers', doc.layers],
    ['swatches', doc.swatches],
    ['frames', doc.frames],
    ['stories', doc.stories],
    ['paragraphStyles', doc.paragraphStyles],
    ['characterStyles', doc.characterStyles],
    ['assets', doc.assets],
    ['guides', doc.guides],
  ] as const) {
    for (const [key, value] of Object.entries(records)) {
      if (value.id !== key) add('id-mismatch', `${collection}.${key}`, `record key "${key}" does not match object id "${value.id}"`);
    }
  }

  // order arrays are permutations of their records
  for (const [name, order, records] of [
    ['pageOrder', doc.pageOrder, doc.pages],
    ['layerOrder', doc.layerOrder, doc.layers],
    ['swatchOrder', doc.swatchOrder, doc.swatches],
    ['paragraphStyleOrder', doc.paragraphStyleOrder, doc.paragraphStyles],
    ['characterStyleOrder', doc.characterStyleOrder, doc.characterStyles],
  ] as const) {
    const seen = new Set<Id>();
    for (const id of order) {
      if (!(id in records)) add('dangling-id', name, `"${id}" is not an existing object`);
      if (seen.has(id)) add('order-mismatch', name, `"${id}" is listed twice`);
      seen.add(id);
    }
    for (const id of Object.keys(records)) if (!seen.has(id)) add('order-mismatch', name, `"${id}" is missing from the order`);
  }
  if (doc.pageOrder.length === 0) add('order-mismatch', 'pageOrder', 'a document needs at least one page');
  if (doc.layerOrder.length === 0) add('order-mismatch', 'layerOrder', 'a document needs at least one layer');

  // frame placement: every frame is listed exactly once, by a page or by a group
  const placed = new Map<Id, string>();
  const place = (id: Id, where: string) => {
    if (!(id in doc.frames)) {
      add('dangling-id', where, `"${id}" is not an existing frame`);
      return;
    }
    const previous = placed.get(id);
    if (previous) add('duplicate-placement', where, `frame "${id}" is also listed in ${previous}`);
    else placed.set(id, where);
  };
  for (const page of Object.values(doc.pages)) page.items.forEach((id, i) => place(id, `pages.${page.id}.items[${i}]`));
  for (const f of Object.values(doc.frames)) {
    if (f.type === 'group') f.childIds.forEach((id, i) => place(id, `frames.${f.id}.childIds[${i}]`));
  }

  // reachability from pages (catches a group cycle that is detached from every page)
  const reached = new Set<Id>();
  const walk = (id: Id, stack: Id[]) => {
    if (stack.includes(id)) {
      add('group-cycle', `frames.${id}`, `group "${id}" contains itself`);
      return;
    }
    if (reached.has(id)) return;
    reached.add(id);
    const f = doc.frames[id];
    if (f?.type === 'group') for (const c of f.childIds) walk(c, [...stack, id]);
  };
  for (const page of Object.values(doc.pages)) for (const id of page.items) walk(id, []);
  for (const id of Object.keys(doc.frames)) {
    if (!reached.has(id)) add('unreachable-frame', `frames.${id}`, 'frame is not on any page');
  }

  // frames
  for (const f of Object.values(doc.frames)) {
    const at = `frames.${f.id}`;
    if (!(f.layerId in doc.layers)) add('dangling-id', `${at}.layerId`, `layer "${f.layerId}" does not exist`);
    if (f.type === 'group') {
      for (const c of f.childIds) {
        const child = doc.frames[c];
        if (child && child.layerId !== f.layerId) add('layer-mismatch', `${at}.childIds`, `child "${c}" is on a different layer than its group`);
      }
      continue;
    }
    for (const part of ['fill', 'stroke'] as const) {
      const paintRef = part === 'fill' ? f.fill : f.stroke?.paint;
      if (paintRef && !(paintRef.swatchId in doc.swatches)) {
        add('dangling-id', `${at}.${part}.swatchId`, `swatch "${paintRef.swatchId}" does not exist`);
      }
    }
    if (f.type === 'text') {
      const story = doc.stories[f.storyId];
      if (!story) add('dangling-id', `${at}.storyId`, `story "${f.storyId}" does not exist`);
      else if (story.frameIds.filter((id) => id === f.id).length !== 1) {
        add('thread-rule', `${at}.storyId`, `story "${f.storyId}" does not list this frame exactly once in its thread`);
      }
    }
    if (f.type === 'image' && f.assetId !== null && !(f.assetId in doc.assets)) {
      add('dangling-id', `${at}.assetId`, `asset "${f.assetId}" does not exist`);
    }
  }

  // stories and threads: the chain lists exactly the text frames that point back at the story
  for (const s of Object.values(doc.stories)) {
    const at = `stories.${s.id}`;
    if (s.frameIds.length === 0) add('story-rule', at, 'story is not used by any text frame');
    const seen = new Set<Id>();
    for (const [i, frameId] of s.frameIds.entries()) {
      const where = `${at}.frameIds[${i}]`;
      const frame = doc.frames[frameId];
      if (!frame) add('dangling-id', where, `"${frameId}" is not an existing frame`);
      else if (frame.type !== 'text') add('thread-rule', where, `"${frameId}" is not a text frame`);
      else if (frame.storyId !== s.id) add('thread-rule', where, `frame "${frameId}" belongs to story "${frame.storyId}"`);
      if (seen.has(frameId)) add('thread-rule', where, `"${frameId}" is listed twice in the thread`);
      seen.add(frameId);
    }
    const problem = storyDocReferenceProblem(s.doc, doc);
    if (problem) add('dangling-id', `${at}.doc`, problem);
  }

  // styles
  validateStyles(doc, add);

  // swatches
  const names = new Map<string, Id>();
  for (const s of Object.values(doc.swatches)) {
    const other = names.get(s.name);
    if (other) add('duplicate-name', `swatches.${s.id}.name`, `name "${s.name}" is already used by swatch "${other}"`);
    else names.set(s.name, s.id);
    if (s.type === 'tint') {
      const base = doc.swatches[s.baseId];
      if (!base) add('dangling-id', `swatches.${s.id}.baseId`, `base swatch "${s.baseId}" does not exist`);
      else if (base.type === 'tint') add('swatch-rule', `swatches.${s.id}.baseId`, 'a tint swatch cannot be based on another tint swatch');
    }
  }
  for (const id of ['paper', 'black']) {
    if (!(id in doc.swatches)) add('swatch-rule', `swatches.${id}`, `built-in swatch "${id}" is missing`);
  }

  // guides
  for (const g of Object.values(doc.guides)) {
    if (!(g.pageId in doc.pages)) add('dangling-id', `guides.${g.id}.pageId`, `page "${g.pageId}" does not exist`);
  }

  return issues;
}

function validateStyles(doc: GalleyDocument, add: (code: ValidationIssue['code'], path: string, message: string) => void): void {
  for (const [kind, table] of [
    ['paragraphStyles', doc.paragraphStyles],
    ['characterStyles', doc.characterStyles],
  ] as const) {
    const names = new Map<string, Id>();
    for (const style of Object.values(table)) {
      const at = `${kind}.${style.id}`;
      const other = names.get(style.name);
      if (other) add('duplicate-name', `${at}.name`, `name "${style.name}" is already used by style "${other}"`);
      else names.set(style.name, style.id);

      if (style.basedOn !== null && !(style.basedOn in table)) add('dangling-id', `${at}.basedOn`, `style "${style.basedOn}" does not exist`);
      // a cycle: walk up the chain and see whether it comes back
      const seen = new Set<Id>([style.id]);
      for (let up = style.basedOn; up !== null && up in table; up = table[up]!.basedOn) {
        if (seen.has(up)) {
          if (up === style.id) add('style-cycle', `${at}.basedOn`, `style "${style.id}" is based on itself through "${style.basedOn}"`);
          break;
        }
        seen.add(up);
      }
      const fill = style.shared.fill;
      if (fill && !(fill.swatchId in doc.swatches)) add('dangling-id', `${at}.shared.fill.swatchId`, `swatch "${fill.swatchId}" does not exist`);
    }
  }
  const basic = doc.paragraphStyles[BASIC_PARAGRAPH_ID];
  if (!basic) add('style-rule', `paragraphStyles.${BASIC_PARAGRAPH_ID}`, 'built-in paragraph style [Basic Paragraph] is missing');
  else if (basic.basedOn !== null) add('style-rule', `paragraphStyles.${BASIC_PARAGRAPH_ID}.basedOn`, '[Basic Paragraph] cannot be based on another style');
  const none = doc.characterStyles[NONE_CHARACTER_ID];
  if (!none) add('style-rule', `characterStyles.${NONE_CHARACTER_ID}`, 'built-in character style [None] is missing');
  else if (none.basedOn !== null) add('style-rule', `characterStyles.${NONE_CHARACTER_ID}.basedOn`, '[None] cannot be based on another style');
}

export function assertValidDocument(doc: GalleyDocument): void {
  const issues = validateDocument(doc);
  if (issues.length > 0) throw new DocumentValidationError(issues);
}
