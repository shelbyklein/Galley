import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

export interface ReorderOptions {
  /** Called once when a drag ends over a different slot: move the item at `from` to position `to`. */
  onMove(from: number, to: number): void;
  /** Which way the items lie, so "nearest slot" is measured sensibly. */
  axis: 'y' | 'both';
}

/** Pixels the pointer must travel before a press becomes a drag (so plain clicks stay clicks). */
const DRAG_THRESHOLD = 5;

/**
 * Drag-to-reorder for a list of slots, using pointer events (they work the same for a mouse, a pen and Playwright).
 * Mark each slot with `data-reorder-index={n}` and give it `onPointerDown={start(n)}`. While dragging, `drag` says which
 * slot is being moved and which one it is over, for drawing the drop marker. A drag does not click: check
 * `wasDragged()` first in click handlers.
 */
export function useReorder({ onMove, axis }: ReorderOptions) {
  const container = useRef<HTMLElement | null>(null);
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null);
  const justDragged = useRef(false);

  const slotAt = (x: number, y: number, fallback: number): number => {
    const slots = Array.from(container.current?.querySelectorAll<HTMLElement>('[data-reorder-index]') ?? []);
    let best = fallback;
    let bestDistance = Infinity;
    for (const el of slots) {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const distance = axis === 'y' ? Math.abs(y - cy) : Math.hypot(x - cx, y - cy);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = Number(el.dataset.reorderIndex);
      }
    }
    return best;
  };

  const start = (index: number) => (event: ReactPointerEvent) => {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest('button, input, select, textarea')) return;
    const startX = event.clientX;
    const startY = event.clientY;
    let active = false;
    let over = index;
    const move = (e: PointerEvent) => {
      if (!active && Math.hypot(e.clientX - startX, e.clientY - startY) < DRAG_THRESHOLD) return;
      active = true;
      over = slotAt(e.clientX, e.clientY, over);
      setDrag({ from: index, over });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointercancel', up);
      setDrag(null);
      if (!active) return;
      justDragged.current = true;
      setTimeout(() => {
        justDragged.current = false;
      }, 0);
      if (over !== index) onMove(index, over);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
    window.addEventListener('pointercancel', up, { once: true });
  };

  return {
    /** Put on the element that contains the slots. */
    containerRef: (el: HTMLElement | null) => {
      container.current = el;
    },
    start,
    drag,
    wasDragged: () => justDragged.current,
  };
}
