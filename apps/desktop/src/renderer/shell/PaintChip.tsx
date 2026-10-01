import { createColorResolver, type ColorResolver } from '@galley/render';
import type { Paint } from '@galley/model';
import { useMemo, type CSSProperties } from 'react';
import { selectDoc, useEditorStore } from '../store';

/** Resolves paints to the CSS colors the canvas shows (screen mode). Re-created only when the swatches change. */
export function useScreenColors(): ColorResolver {
  const swatches = useEditorStore((s) => selectDoc(s).swatches);
  const doc = useEditorStore.getState().history.doc;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => createColorResolver({ ...doc, swatches }, 'screen'), [swatches]);
}

/**
 * A small square of a paint: the swatch color, or a white square with a red slash for [None] (null), as in the
 * mockup's proxy, control strip and Swatches panel. `outline` draws the paint as a thick border (the stroke chip).
 */
export function PaintChip({ paint, colors, size = 14, outline = false, className }: { paint: Paint | null; colors: ColorResolver; size?: number; outline?: boolean; className?: string }) {
  const css = paint ? colors.css(paint) : null;
  const style: CSSProperties = { width: size, height: size };
  if (css && !outline) style.background = css;
  if (css && outline) style.borderColor = css;
  const classes = ['gl-chip', paint ? '' : 'is-none', outline ? 'is-outline' : '', className ?? ''].filter(Boolean).join(' ');
  return <span className={classes} style={style} />;
}
