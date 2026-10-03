import { useShellStore } from './shellStore';

/**
 * Messages over the top of the canvas: errors (a document that would not open), warnings (a different engine version)
 * and the missing-link warning. Each can be dismissed. The status bar keeps showing the missing-link count.
 */
export function Notices() {
  const notices = useShellStore((s) => s.notices);
  const dismiss = useShellStore((s) => s.dismissNotice);
  const missing = useShellStore((s) => s.missingLinks);
  const dismissed = useShellStore((s) => s.linkWarningDismissed);
  const setFileState = useShellStore((s) => s.setFileState);
  return (
    <div className="gl-notices" data-testid="notices">
      {missing.length > 0 && !dismissed && (
        <div className="gl-notice is-warning" role="alert" data-testid="link-warning">
          <div className="gl-notice-text">
            <strong>{missing.length === 1 ? '1 linked image is missing' : `${missing.length} linked images are missing`}</strong>
            <span className="gl-notice-detail">{missing.map((m) => m.path).join(', ')}</span>
            <span className="gl-notice-detail">Use Window &gt; Links to relink, or restore the packaged file and choose Check Links.</span>
          </div>
          <button type="button" className="gl-notice-close" aria-label="Dismiss" onClick={() => setFileState({ linkWarningDismissed: true })}>
            {'×'}
          </button>
        </div>
      )}
      {notices.map((n) => (
        <div key={n.id} className={`gl-notice is-${n.level}`} role="alert" data-testid="notice" data-level={n.level}>
          <div className="gl-notice-text">
            <strong>{n.text}</strong>
            {n.detail && <span className="gl-notice-detail">{n.detail}</span>}
          </div>
          <button type="button" className="gl-notice-close" aria-label="Dismiss" onClick={() => dismiss(n.id)}>
            {'×'}
          </button>
        </div>
      ))}
    </div>
  );
}
