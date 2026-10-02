import type { Id } from '../ids';
import { cmykSchema, isBuiltinSwatch, SWATCH_BLACK, swatchSchema, type Cmyk, type Paint, type Swatch } from '../swatch';
import { mapDocFills } from '../text/ops';
import { BASIC_PARAGRAPH_ID } from '../text/styles';
import { percentSchema } from '../units';
import { defineCommand, fail } from './types';
import { baseOf, insertAt, own, removeFrom, swatchOf } from './util';

function assertUniqueName(d: { swatches: Record<Id, Swatch> }, name: string, exceptId?: Id): void {
  for (const s of Object.values(d.swatches)) {
    if (s.id !== exceptId && s.name === name) fail(`A swatch named "${name}" already exists`);
  }
}

/** Add a CMYK, spot or tint swatch. `index` is the position in the Swatches panel; default the end. */
export const addSwatch = defineCommand<{ swatch: Swatch; index?: number }>('swatch.add', 'New Swatch', (d, { swatch, index }) => {
  const r = swatchSchema.safeParse(swatch);
  if (!r.success) fail(`Invalid swatch: ${r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  if (d.swatches[swatch.id]) fail(`Swatch "${swatch.id}" already exists`);
  assertUniqueName(d, swatch.name);
  if (swatch.type === 'tint') {
    const base = d.swatches[swatch.baseId];
    if (!base) fail(`No swatch "${swatch.baseId}"`);
    if (base.type === 'tint') fail('A tint swatch cannot be based on another tint swatch');
  }
  insertAt(d.swatchOrder, swatch.id, index);
  d.swatches[swatch.id] = own(swatch);
});

export interface SwatchProps {
  name?: string;
  /** cmyk and spot swatches. */
  values?: Cmyk;
  /** tint swatches. */
  percent?: number;
}

/** Rename a swatch or change its values. Every use of it updates, because paints refer to swatches by id. Built-ins are fixed. */
export const setSwatchProps = defineCommand<{ id: Id; props: SwatchProps }>('swatch.setProps', 'Edit Swatch', (d, { id, props }) => {
  const s = swatchOf(d, id);
  if (isBuiltinSwatch(id)) fail(`The built-in swatch "${s.name}" cannot be edited`);
  if (props.name !== undefined) {
    if (props.name.trim() === '') fail('A swatch needs a name');
    assertUniqueName(d, props.name, id);
    s.name = props.name;
  }
  if (props.values !== undefined) {
    if (s.type === 'tint') fail('A tint swatch has no values; edit its base swatch');
    const r = cmykSchema.safeParse(props.values);
    if (!r.success) fail('values must be four numbers from 0 to 100');
    s.values = own(r.data);
  }
  if (props.percent !== undefined) {
    if (s.type !== 'tint') fail('percent applies to tint swatches only');
    const r = percentSchema.safeParse(props.percent);
    if (!r.success) fail('percent must be a number from 0 to 100');
    s.percent = r.data;
  }
});

/**
 * Delete a swatch, plus the tint swatches based on it. Anything painted with a deleted swatch switches to
 * `replacementId` if given, else to [None]. Text has no [None] color: a style or local override that used the swatch
 * drops its color and inherits (so it ends up [Black] at the root; [Basic Paragraph] itself switches to [Black]). Built-ins stay.
 */
export const removeSwatch = defineCommand<{ id: Id; replacementId?: Id | null }>('swatch.remove', 'Delete Swatch', (d, { id, replacementId = null }) => {
  swatchOf(d, id);
  if (isBuiltinSwatch(id)) fail('Built-in swatches cannot be deleted');
  const doomed = new Set<Id>([id]);
  for (const s of Object.values(d.swatches)) if (s.type === 'tint' && s.baseId === id) doomed.add(s.id);
  if (replacementId !== null) {
    swatchOf(d, replacementId);
    if (doomed.has(replacementId)) fail('The replacement swatch is being deleted too');
  }
  const replace = (p: Paint | null): Paint | null => {
    if (!p || !doomed.has(p.swatchId)) return p;
    return replacementId === null ? null : { swatchId: replacementId, tint: p.tint, overprint: p.overprint };
  };
  for (const f of Object.values(d.frames)) {
    if (f.type === 'group') continue;
    if (f.fill && doomed.has(f.fill.swatchId)) f.fill = replace(f.fill);
    if (f.stroke && doomed.has(f.stroke.paint.swatchId)) {
      const p = replace(f.stroke.paint);
      f.stroke = p ? { paint: p, weight: f.stroke.weight } : null;
    }
  }
  for (const table of [d.paragraphStyles, d.characterStyles]) {
    for (const style of Object.values(table)) {
      const fill = style.shared.fill;
      if (!fill || !doomed.has(fill.swatchId)) continue;
      const next = replace(fill);
      if (next) style.shared.fill = next;
      else if (style.id === BASIC_PARAGRAPH_ID) style.shared.fill = { swatchId: SWATCH_BLACK, tint: 100, overprint: false };
      else delete style.shared.fill;
    }
  }
  const before = baseOf(d);
  for (const s of Object.values(d.stories)) {
    const doc = before.stories[s.id]!.doc;
    const next = mapDocFills(doc, (fill) => (doomed.has(fill.swatchId) ? replace(fill) : fill));
    if (next !== doc) s.doc = own(next) as typeof s.doc;
  }
  for (const gone of doomed) {
    removeFrom(d.swatchOrder, gone);
    delete d.swatches[gone];
  }
});
