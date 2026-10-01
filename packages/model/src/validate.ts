/**
 * Integrity checks the schema cannot express: dangling ids, one placement per frame, order arrays that match their
 * records, swatch rules. `validateDocument` returns every problem it finds; `assertValidDocument` throws on the
 * first set. Commands are tested to keep every document valid; the app runs this on open and in dev builds, not on
 * every keystroke.
 */
import type { Id } from './ids';
import type { GalleyDocument } from './schema';

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
  const storyUse = new Map<Id, Id>();
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
      if (!(f.storyId in doc.stories)) add('dangling-id', `${at}.storyId`, `story "${f.storyId}" does not exist`);
      const other = storyUse.get(f.storyId);
      if (other) add('story-rule', `${at}.storyId`, `story "${f.storyId}" is already used by frame "${other}" (one story per frame)`);
      else storyUse.set(f.storyId, f.id);
    }
    if (f.type === 'image' && f.assetId !== null && !(f.assetId in doc.assets)) {
      add('dangling-id', `${at}.assetId`, `asset "${f.assetId}" does not exist`);
    }
  }

  // stories
  for (const s of Object.values(doc.stories)) {
    if (!storyUse.has(s.id)) add('story-rule', `stories.${s.id}`, 'story is not used by any text frame');
    if (!(s.defaults.fill.swatchId in doc.swatches)) {
      add('dangling-id', `stories.${s.id}.defaults.fill.swatchId`, `swatch "${s.defaults.fill.swatchId}" does not exist`);
    }
  }

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

export function assertValidDocument(doc: GalleyDocument): void {
  const issues = validateDocument(doc);
  if (issues.length > 0) throw new DocumentValidationError(issues);
}
