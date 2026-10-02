import { assertFinite } from './util';
import { defineCommand, fail } from './types';

/** Document title and output profile. (`meta.engineVersion` is stamped when saving, never by a command.) */
export const setMeta = defineCommand<{ title?: string; colorProfile?: string | null }>('doc.setMeta', 'Document Setup', (d, { title, colorProfile }) => {
  if (title !== undefined) d.meta.title = title;
  if (colorProfile !== undefined) d.meta.colorProfile = colorProfile;
});

/** The document baseline grid: where it starts (points from the top of the page) and its increment (points, above zero). */
export const setBaselineGrid = defineCommand<{ start?: number; increment?: number }>('doc.setBaselineGrid', 'Baseline Grid', (d, { start, increment }) => {
  if (start !== undefined) {
    assertFinite(start, 'start');
    if (start < 0) fail('The grid cannot start above the page');
    d.baselineGrid.start = start;
  }
  if (increment !== undefined) {
    assertFinite(increment, 'increment');
    if (increment <= 0) fail('The grid increment must be above zero');
    d.baselineGrid.increment = increment;
  }
});
