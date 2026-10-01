import type { Id } from '../ids';
import { pageSchema, type Columns, type Insets, type Page } from '../schema';
import { defineCommand, fail } from './types';
import { deleteFrameTrees, insertAt, own, pageOf, removeFrom } from './util';

function parsePage(page: unknown): Page {
  const r = pageSchema.safeParse(page);
  if (!r.success) fail(`Invalid page: ${r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  return r.data;
}

/** Add an empty page (`page.items` must be empty). `index` is the position in the page order; default the end. */
export const addPage = defineCommand<{ page: Page; index?: number }>('page.add', 'Add Page', (d, { page, index }) => {
  parsePage(page);
  if (page.items.length > 0) fail('A new page must be empty');
  if (d.pages[page.id]) fail(`Page "${page.id}" already exists`);
  insertAt(d.pageOrder, page.id, index);
  d.pages[page.id] = own(page);
});

/** Delete a page with its frames and guides. The last page cannot be deleted. */
export const removePage = defineCommand<{ id: Id }>('page.remove', 'Delete Page', (d, { id }) => {
  const page = pageOf(d, id);
  if (d.pageOrder.length <= 1) fail('A document needs at least one page');
  deleteFrameTrees(d, [...page.items]);
  for (const g of Object.values(d.guides)) if (g.pageId === id) delete d.guides[g.id];
  removeFrom(d.pageOrder, id);
  delete d.pages[id];
});

/** Move a page to a new position in the page order (the Pages panel's drag). */
export const movePage = defineCommand<{ id: Id; index: number }>('page.move', 'Move Page', (d, { id, index }) => {
  pageOf(d, id);
  if (!Number.isInteger(index) || index < 0 || index >= d.pageOrder.length) fail(`Index ${index} is out of range`);
  removeFrom(d.pageOrder, id);
  d.pageOrder.splice(index, 0, id);
});

export interface PageProps {
  width?: number;
  height?: number;
  margins?: Insets;
  columns?: Columns;
  bleed?: Insets;
  slug?: Insets;
}

/** Change a page's size, margins, columns, bleed or slug. Frames keep their coordinates. */
export const setPageProps = defineCommand<{ id: Id; props: PageProps }>('page.setProps', 'Page Setup', (d, { id, props }) => {
  const page = pageOf(d, id);
  const next = { ...JSON.parse(JSON.stringify(page)), ...props } as Page;
  parsePage(next);
  for (const key of Object.keys(props) as (keyof PageProps)[]) {
    if (props[key] !== undefined) (page as unknown as Record<string, unknown>)[key] = own(props[key]);
  }
});
