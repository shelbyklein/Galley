import { FontWarnings } from './FontWarnings';
import { useEffect, useSyncExternalStore } from 'react';
import { exportDialog } from './exportState';
import './export-dialog.css';

const formatBytes = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / (1024 * 1024)).toFixed(1)} MB`);
const formatPt = (n: number) => `${Math.round(n * 100) / 100} pt`;

/** File > Export > PDF/X-4…: the options (bleed, crop marks), progress, and the result or the error. Lane A. */
export function ExportDialog() {
  const s = useSyncExternalStore(exportDialog.subscribe, exportDialog.get);

  useEffect(() => {
    if (!s.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') exportDialog.close();
      else if (e.key === 'Enter' && exportDialog.get().phase === 'options') void exportDialog.run();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [s.open]);

  if (!s.open) return null;
  const running = s.phase === 'running';

  return (
    <div className="gl-export-scrim" data-testid="export-dialog-scrim" onMouseDown={(e) => e.target === e.currentTarget && exportDialog.close()}>
      <div className="gl-export-dialog" role="dialog" aria-modal="true" aria-labelledby="gl-export-title" data-testid="export-dialog" data-phase={s.phase}>
        <h2 id="gl-export-title">Export PDF/X-4</h2>

        {(s.phase === 'options' || running) && (
          <>
            <fieldset disabled={running} className="gl-export-options">
              <label>
                <input type="checkbox" data-testid="export-bleed" checked={s.options.bleed} onChange={(e) => exportDialog.setOption('bleed', e.target.checked)} />
                <span>Include bleed</span>
                <small>Off cuts the art at the trim edge.</small>
              </label>
              <label>
                <input type="checkbox" data-testid="export-marks" checked={s.options.marks} onChange={(e) => exportDialog.setOption('marks', e.target.checked)} />
                <span>Crop marks and registration targets</span>
                <small>Drawn in registration color, so they print on every plate.</small>
              </label>
            </fieldset>
            <FontWarnings />
            {running && (
              <p className="gl-export-progress" data-testid="export-progress" role="status">
                <span className="gl-export-spinner" aria-hidden="true" />
                {s.progress?.message ?? 'Exporting'}…
              </p>
            )}
          </>
        )}

        {s.phase === 'done' && s.summary && (
          <div data-testid="export-result">
            <p className="gl-export-ok">Saved {formatBytes(s.summary.bytes)}</p>
            <p className="gl-export-path" data-testid="export-path">
              {s.summary.path}
            </p>
            <p className="gl-export-detail">
              Trim {formatPt(s.summary.trim.width)} × {formatPt(s.summary.trim.height)}, sheet {formatPt(s.summary.sheet.width)} × {formatPt(s.summary.sheet.height)}. Output intent: {s.summary.profile.name}
              {s.summary.spots.length > 0 ? `. Spot colors: ${s.summary.spots.join(', ')}` : ''}.
            </p>
            {s.summary.fonts && s.summary.fonts.length > 0 && (
              <details data-testid="export-font-report" className="gl-export-font-report">
                <summary>Font report ({s.summary.fonts.length})</summary>
                <ul>{s.summary.fonts.map((font) => <li key={`${font.family}:${font.weight}:${font.style}`}>
                  {font.family} {font.weight} {font.style}: {font.status === 'instanced' ? 'static TrueType instance' : font.status === 'type3' ? 'Type 3 (CFF)' : font.status === 'substituted' ? `substituted with ${font.resolvedFamily}` : 'TrueType'} ({font.source})
                </li>)}</ul>
              </details>
            )}
            {s.summary.warnings.length > 0 && (
              <ul className="gl-export-warnings" data-testid="export-warnings">
                {s.summary.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {s.phase === 'error' && (
          <p className="gl-export-error" role="alert" data-testid="export-error">
            {s.error}
          </p>
        )}

        <div className="gl-export-buttons">
          {s.phase === 'options' && (
            <>
              <button type="button" onClick={() => exportDialog.close()}>
                Cancel
              </button>
              <button type="button" className="primary" data-testid="export-run" onClick={() => void exportDialog.run()}>
                Export…
              </button>
            </>
          )}
          {running && (
            <button type="button" disabled>
              Working…
            </button>
          )}
          {s.phase === 'done' && (
            <button type="button" className="primary" data-testid="export-done" onClick={() => exportDialog.close()}>
              Done
            </button>
          )}
          {s.phase === 'error' && (
            <>
              <button type="button" onClick={() => exportDialog.close()}>
                Close
              </button>
              <button type="button" className="primary" data-testid="export-retry" onClick={() => exportDialog.retry()}>
                Back to options
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
