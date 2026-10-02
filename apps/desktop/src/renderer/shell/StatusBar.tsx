import { ProfileStatus } from '../status/ProfileStatus';
import { inches, mm, type Page } from '@galley/model';
import { presetForSize } from '../dialogs/presets';
import { commands } from '../commands/registry';
import { selectDoc, selectCurrentPage, useEditorStore } from '../store';
import { trimNumber } from './control-strip/units';
import { useShellStore } from './shellStore';

/** `Tabloid 11 × 17 in`, `A4 210 × 297 mm`, or the size in inches for a custom page. */
export function pageSizeLabel(page: Page): string {
  const preset = presetForSize(page.width, page.height);
  const metric = preset?.id.startsWith('a') ?? false;
  const fmt = (pt: number) => trimNumber(metric ? pt / mm(1) : pt / inches(1), 3);
  const size = `${fmt(page.width)} × ${fmt(page.height)} ${metric ? 'mm' : 'in'}`;
  return preset && /^[A-Za-z]/.test(preset.label) ? `${preset.label} ${size}` : size;
}

export function bleedLabel(page: Page): string {
  const { top, right, bottom, left } = page.bleed;
  if (top === 0 && right === 0 && bottom === 0 && left === 0) return 'no bleed';
  const fmt = (pt: number) => trimNumber(pt / inches(1), 3);
  if (top === right && right === bottom && bottom === left) return `bleed ${fmt(top)} in`;
  return `bleed ${[top, right, bottom, left].map(fmt).join(' / ')} in`;
}

export function columnsLabel(page: Page): string {
  return `${page.columns.count} ${page.columns.count === 1 ? 'column' : 'columns'}`;
}

/**
 * Status bar: zoom, page navigation, a one-line description of the page, and (right) warnings and hints. Lane A
 * inserts the soft-proof profile indicator into the `gl-status-right` group with a one-line edit; keep that group.
 */
export function StatusBar() {
  const doc = useEditorStore(selectDoc);
  const page = useEditorStore(selectCurrentPage);
  const zoom = useEditorStore((s) => s.viewport.zoom);
  const setCurrentPage = useEditorStore((s) => s.setCurrentPage);
  const missing = useShellStore((s) => s.missingLinks);
  const index = doc.pageOrder.indexOf(page.id);
  const goTo = (i: number) => {
    const id = doc.pageOrder[i];
    if (id) setCurrentPage(id);
  };
  const canExport = commands.has('file.exportPdf');
  return (
    <>
      <span className="gl-status-zoom" data-testid="zoom-readout">
        {Math.round(zoom * 100)}%
      </span>
      <span className="gl-status-pages" data-testid="page-nav">
        <button type="button" className="gl-status-step" aria-label="Previous page" disabled={index <= 0} onClick={() => goTo(index - 1)}>
          {'◂'}
        </button>
        <span data-testid="page-number">{index + 1}</span>
        <button type="button" className="gl-status-step" aria-label="Next page" disabled={index >= doc.pageOrder.length - 1} onClick={() => goTo(index + 1)}>
          {'▸'}
        </button>
      </span>
      <span className="gl-status-summary" data-testid="page-summary">
        {pageSizeLabel(page)} {'·'} {bleedLabel(page)} {'·'} {columnsLabel(page)}
      </span>
      <span className="gl-status-spacer" />
      <span className="gl-status-right" data-slot="status-right">
        {missing.length > 0 && (
          <span className="gl-status-warning" data-testid="status-missing-links" title={missing.map((m) => m.path).join('\n')}>
            {'⚠'} {missing.length} missing {missing.length === 1 ? 'link' : 'links'}
          </span>
        )}
        {canExport && (
          <button type="button" className="gl-status-hint" onClick={() => void commands.execute('file.exportPdf')}>
            File {'›'} Export {'›'} PDF/X-4{'…'}
          </button>
        )}
        <ProfileStatus />
      </span>
    </>
  );
}
