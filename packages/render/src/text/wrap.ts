import type { WrapSpec } from './slots';
import type {CSSProperties} from 'react';

export function wrapCss(w:WrapSpec):CSSProperties {
  return {float:w.side,width:`${w.width}pt`,height:`${w.height}pt`,marginTop:`${w.top}pt`,shapeOutside:w.shape};
}

/** The invisible float for one wrap. Identical in the measurement host and in the live frames. */
export function makeWrapEl(w: WrapSpec): HTMLElement {
  const el = document.createElement('div');
  el.className = 'wrap';
  el.setAttribute('contenteditable', 'false');
  el.setAttribute('aria-hidden', 'true');
  Object.assign(el.style,wrapCss(w));
  return el;
}
