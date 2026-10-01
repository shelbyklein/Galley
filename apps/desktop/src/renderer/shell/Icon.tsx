import type { CSSProperties } from 'react';
import caretDown from './icons/caret-down.svg';
import caretRight from './icons/caret-right.svg';
import chain from './icons/chain.svg';
import eye from './icons/eye.svg';
import lock from './icons/lock.svg';
import lockOpen from './icons/lock-open.svg';
import plus from './icons/plus.svg';
import process from './icons/process.svg';
import rotate from './icons/rotate.svg';
import spot from './icons/spot.svg';
import tint from './icons/tint.svg';
import toolDirect from './icons/tool-direct.svg';
import toolEllipse from './icons/tool-ellipse.svg';
import toolFrame from './icons/tool-frame.svg';
import toolHand from './icons/tool-hand.svg';
import toolLine from './icons/tool-line.svg';
import toolRect from './icons/tool-rect.svg';
import toolSelect from './icons/tool-select.svg';
import toolType from './icons/tool-type.svg';
import toolZoom from './icons/tool-zoom.svg';
import trash from './icons/trash.svg';

/**
 * The shell's icons are SVG files used as CSS masks, so they take the text color of whatever they sit in (hover,
 * active and disabled states need no extra artwork) and the renderer code never contains shape markup (the page
 * renderer is the only place that draws shapes; see src/entries.test.ts).
 */
const ICONS = {
  'caret-down': caretDown,
  'caret-right': caretRight,
  chain,
  eye,
  lock,
  'lock-open': lockOpen,
  plus,
  process,
  rotate,
  spot,
  tint,
  'tool-direct': toolDirect,
  'tool-ellipse': toolEllipse,
  'tool-frame': toolFrame,
  'tool-hand': toolHand,
  'tool-line': toolLine,
  'tool-rect': toolRect,
  'tool-select': toolSelect,
  'tool-type': toolType,
  'tool-zoom': toolZoom,
  trash,
} as const;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }) {
  const style = { '--gl-icon-url': `url("${ICONS[name]}")`, width: size, height: size } as CSSProperties;
  return <span className={className ? `gl-icon ${className}` : 'gl-icon'} style={style} aria-hidden="true" />;
}
