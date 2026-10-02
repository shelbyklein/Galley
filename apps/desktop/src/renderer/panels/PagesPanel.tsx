import { addPage, createId, makePage, movePage, removePage } from '@galley/model';
import { selectDoc, useEditorStore } from '../store';
import { Icon } from '../shell/Icon';
import { useScreenColors } from '../shell/PaintChip';
import { FooterButton, Panel } from './Panel';
import { PageThumb } from './PageThumb';
import { useReorder } from './useReorder';

/** Add a page after the current one, with the current page's size, margins, columns, bleed and slug, and go to it. */
export function insertPage(): void {
  const store = useEditorStore.getState();
  const doc = selectDoc(store);
  const base = doc.pages[store.currentPageId]!;
  const page = makePage({ id: createId('page'), width: base.width, height: base.height, margins: base.margins, columns: base.columns, bleed: base.bleed, slug: base.slug });
  store.dispatch(addPage, { page, index: doc.pageOrder.indexOf(base.id) + 1 });
  useEditorStore.getState().setCurrentPage(page.id);
}

/** Delete the current page (and its frames); the next page, or the previous one, becomes current. The last page stays. */
export function deleteCurrentPage(): void {
  const store = useEditorStore.getState();
  const doc = selectDoc(store);
  if (doc.pageOrder.length <= 1) return;
  const index = doc.pageOrder.indexOf(store.currentPageId);
  store.dispatch(removePage, { id: store.currentPageId });
  const after = selectDoc(useEditorStore.getState());
  useEditorStore.getState().setCurrentPage(after.pageOrder[Math.min(index, after.pageOrder.length - 1)]!);
}

/** Move the current page one place earlier (-1) or later (+1). */
export function moveCurrentPage(delta: -1 | 1): void {
  const store = useEditorStore.getState();
  const doc = selectDoc(store);
  const index = doc.pageOrder.indexOf(store.currentPageId);
  const to = index + delta;
  if (to < 0 || to >= doc.pageOrder.length) return;
  store.dispatch(movePage, { id: store.currentPageId, index: to });
}

/**
 * Pages panel: a thumbnail per page (click to go to it, drag to reorder), with New Page and Delete Page in the footer.
 * There are no spreads or parent pages in Phase 1, so every page is its own spread.
 */
export function PagesPanel() {
  const doc = useEditorStore(selectDoc);
  const currentPageId = useEditorStore((s) => s.currentPageId);
  const setCurrentPage = useEditorStore((s) => s.setCurrentPage);
  const colors = useScreenColors();
  const count = doc.pageOrder.length;
  const index = doc.pageOrder.indexOf(currentPageId);
  const reorder = useReorder({
    axis: 'both',
    onMove: (from, to) => useEditorStore.getState().dispatch(movePage, { id: doc.pageOrder[from]!, index: to }),
  });
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  return (
    <Panel
      id="pages"
      menu={[
        { label: 'Insert Page', onSelect: insertPage },
        { label: 'Delete Page', onSelect: deleteCurrentPage, disabled: count <= 1 },
        { label: 'Move Page Backward', onSelect: () => moveCurrentPage(-1), disabled: index <= 0 },
        { label: 'Move Page Forward', onSelect: () => moveCurrentPage(1), disabled: index >= count - 1 },
      ]}
      footer={
        <>
          <span className="gl-panel-note" data-testid="pages-summary">
            {plural(count, 'Page')} in {plural(count, 'Spread')}
          </span>
          <span className="gl-footer-spacer" />
          <FooterButton label="New Page" onClick={insertPage} testId="pages-new">
            <Icon name="plus" size={14} />
          </FooterButton>
          <FooterButton label="Delete Page" onClick={deleteCurrentPage} disabled={count <= 1} testId="pages-delete">
            <Icon name="trash" size={14} />
          </FooterButton>
        </>
      }
    >
      <div className="gl-pages-grid" ref={reorder.containerRef}>
        {doc.pageOrder.map((id, i) => (
          <div
            key={id}
            className={`gl-page-item${id === currentPageId ? ' is-current' : ''}${reorder.drag?.over === i && reorder.drag.from !== i ? ' is-drop-target' : ''}${reorder.drag?.from === i ? ' is-dragging' : ''}`}
            data-page-id={id}
            data-reorder-index={i}
            onPointerDown={reorder.start(i)}
            onClick={() => !reorder.wasDragged() && setCurrentPage(id)}
          >
            <PageThumb doc={doc} pageId={id} colors={colors} maxW={56} maxH={86} />
            <span className="gl-page-number">{i + 1}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}
