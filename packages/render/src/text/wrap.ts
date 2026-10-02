import type { WrapSpec } from './slots';

/** The invisible float for one wrap. Identical in the measurement host and in the live frames. */
export function makeWrapEl(w: WrapSpec): HTMLElement {
  const el = document.createElement('div');
  el.className = 'wrap';
  el.setAttribute('contenteditable', 'false');
  el.setAttribute('aria-hidden', 'true');
  el.style.cssText = `float:${w.side};width:${w.width}pt;height:${w.height}pt;margin-top:${w.top}pt;shape-outside:${w.shape}`;
  return el;
}
