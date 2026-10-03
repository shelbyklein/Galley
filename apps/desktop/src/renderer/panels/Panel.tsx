import { useEffect, useRef, useState, type ReactNode } from 'react';
import { PANEL_TITLES, useShellStore, type PanelId } from '../shell/shellStore';
import './panels.css';

export interface PanelMenuItem {
  label: string;
  onSelect(): void;
  disabled?: boolean;
}

/**
 * A docked panel: a header (click to collapse or expand, panel menu on the right), a scrolling body and an optional
 * footer. Visibility and collapsed state live in the shell store (and are remembered); a hidden panel renders nothing.
 */
export function Panel({ id, children, footer, menu, busy }: { id: PanelId; children: ReactNode; footer?: ReactNode; menu?: PanelMenuItem[]; busy?: boolean }) {
  const { visible, collapsed } = useShellStore((s) => s.panels[id]);
  const setPanel = useShellStore((s) => s.setPanel);
  if (!visible) return null;
  return (
    <section className={`gl-panel${collapsed ? ' is-collapsed' : ''}`} data-panel={id} data-collapsed={collapsed} aria-busy={busy ?? false}>
      <header className="gl-panel-header" onClick={() => setPanel(id, { collapsed: !collapsed })}>
        <button type="button" className="gl-panel-toggle" aria-expanded={!collapsed} aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${PANEL_TITLES[id]}`}>
          <span className={`gl-panel-caret${collapsed ? ' is-collapsed' : ''}`} />
          <span className="gl-panel-title">{PANEL_TITLES[id]}</span>
        </button>
        {menu && menu.length > 0 && <PanelMenu panel={id} items={menu} />}
      </header>
      {!collapsed && <div className="gl-panel-body">{children}</div>}
      {!collapsed && footer && <footer className="gl-panel-footer">{footer}</footer>}
    </section>
  );
}

/** The panel's ≡ menu: a small popup of actions (also the keyboard route to actions that are drags elsewhere). */
function PanelMenu({ panel, items }: { panel: PanelId; items: PanelMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (wrapper.current && !wrapper.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', away);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('mousedown', away);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);
  return (
    <div className="gl-panel-menu" ref={wrapper} onClick={(e) => e.stopPropagation()}>
      <button type="button" className="gl-panel-menu-button" aria-label={`${PANEL_TITLES[panel]} menu`} aria-haspopup="menu" aria-expanded={open} data-testid={`${panel}-menu`} onClick={() => setOpen(!open)}>
        {'≡'}
      </button>
      {open && (
        <div className="gl-popover gl-popover-right" role="menu" data-testid={`${panel}-menu-list`}>
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className="gl-popover-row"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** A footer button: a small icon button. */
export function FooterButton({ label, onClick, disabled, children, testId }: { label: string; onClick(): void; disabled?: boolean; children: ReactNode; testId?: string }) {
  return (
    <button type="button" className="gl-footer-button" aria-label={label} title={label} disabled={disabled} onClick={onClick} data-testid={testId}>
      {children}
    </button>
  );
}
