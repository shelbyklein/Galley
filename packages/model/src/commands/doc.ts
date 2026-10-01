import { defineCommand } from './types';

/** Document title and output profile. (`meta.engineVersion` is stamped when saving, never by a command.) */
export const setMeta = defineCommand<{ title?: string; colorProfile?: string | null }>('doc.setMeta', 'Document Setup', (d, { title, colorProfile }) => {
  if (title !== undefined) d.meta.title = title;
  if (colorProfile !== undefined) d.meta.colorProfile = colorProfile;
});
