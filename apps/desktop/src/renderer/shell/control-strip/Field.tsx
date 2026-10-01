import { useRef, useState, type KeyboardEvent } from 'react';

export interface FieldProps {
  /** Shown while the field is not being edited. */
  value: string;
  /** Called with the typed text when it changed and the user commits (Enter, Tab or clicking away). Return false to reject it. */
  onCommit(text: string): boolean | void;
  /** Arrow keys: +1 or -1, ten times as large with Shift. Leave out for fields that do not step. */
  onStep?(direction: 1 | -1, big: boolean): void;
  disabled?: boolean;
  /** `data-field` hook for tests. */
  name: string;
  label?: string;
  width?: number;
  title?: string;
  /** Called after Enter has committed (dialogs: press Enter in a field to confirm the dialog). The field keeps focus. */
  onEnter?(): void;
  className?: string;
  /** Pressing Enter commits even when the text is unchanged (the stroke weight of a frame that has no stroke yet). */
  commitUnchanged?: boolean;
}

/**
 * A control-strip text field. It shows `value` (live, even while focused) until the user types; then it shows their
 * draft. Enter commits and gives the keyboard
 * back to the canvas (so tool shortcuts work again), Escape reverts, and leaving the field commits. Cut, copy, paste,
 * select-all and undo act on the text, not on the document (the window's shortcut handler never sees them).
 */
export function Field({ value, onCommit, onStep, disabled, name, label, width, title, onEnter, className, commitUnchanged }: FieldProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  // Enter and Escape blur the field themselves; that blur must not commit again
  const skipBlur = useRef(false);

  const commit = (force = false) => {
    // `draft` exists only after the user typed; an untouched field has nothing to commit unless `force` asks for it
    const text = draft ?? (force ? value : null);
    try {
      if (text !== null && (text !== value || force)) onCommit(text);
    } finally {
      setDraft(null);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if ((e.metaKey || e.ctrlKey) && /^[acvxz]$/i.test(e.key)) {
      e.stopPropagation(); // text editing, not document commands
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      commit(commitUnchanged);
      if (onEnter) {
        onEnter();
      } else {
        skipBlur.current = true;
        ref.current?.blur();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (draft !== null && draft !== value) e.stopPropagation(); // reverting the text is all Escape does here
      setDraft(null);
      skipBlur.current = true;
      ref.current?.blur();
    } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && onStep) {
      e.preventDefault();
      e.stopPropagation();
      if (draft !== null && draft !== value) commit();
      onStep(e.key === 'ArrowUp' ? 1 : -1, e.shiftKey);
      setDraft(null);
    }
  };

  return (
    <label className={className ? `gl-field ${className}` : 'gl-field'} style={width ? { width } : undefined} title={title}>
      {label && <span className="gl-field-label">{label}</span>}
      <input
        ref={ref}
        className="gl-field-input"
        data-field={name}
        type="text"
        spellCheck={false}
        autoComplete="off"
        disabled={disabled}
        value={draft ?? value}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (skipBlur.current) skipBlur.current = false;
          else commit();
        }}
        onKeyDown={onKeyDown}
      />
    </label>
  );
}
