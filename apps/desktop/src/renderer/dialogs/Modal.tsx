import { useEffect, useRef, type FormEvent, type ReactNode } from 'react';
import './dialogs.css';

/**
 * A modal dialog: a dimmed overlay, a titled box, and Cancel / OK buttons. Escape cancels, Enter in a plain field
 * confirms (a form submit), and the first field takes focus. Rendered by `DialogHost`.
 */
export function Modal({
  title,
  testId,
  children,
  okLabel,
  okDisabled,
  onOk,
  onCancel,
  width = 420,
}: {
  title: string;
  testId: string;
  children: ReactNode;
  okLabel: string;
  okDisabled?: boolean;
  onOk(): void;
  onCancel(): void;
  width?: number;
}) {
  const box = useRef<HTMLFormElement>(null);
  useEffect(() => {
    // the first text field (or button) gets the keyboard
    const first = box.current?.querySelector<HTMLElement>('input:not([disabled]), select:not([disabled])');
    first?.focus();
    if (first instanceof HTMLInputElement) first.select();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!okDisabled) onOk();
  };
  return (
    <div className="gl-modal-overlay" data-testid="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <form ref={box} className="gl-modal" role="dialog" aria-modal="true" aria-label={title} data-testid={testId} style={{ width }} onSubmit={submit}>
        <h2 className="gl-modal-title">{title}</h2>
        <div className="gl-modal-body">{children}</div>
        <div className="gl-modal-actions">
          <button type="button" className="gl-button" data-testid="dialog-cancel" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="gl-button is-primary" data-testid="dialog-ok" disabled={okDisabled}>
            {okLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
