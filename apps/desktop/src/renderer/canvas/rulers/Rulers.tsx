import { useLayoutEffect, useRef } from 'react';
import type { DisplayUnits } from '../../store';
import type { Size, ViewTransform } from '../viewport';
import { rulerTicks, type Tick } from './ticks';

export const RULER_SIZE = 18;

interface Palette {
  background: string;
  major: string;
  mid: string;
  minor: string;
  label: string;
}

/** Ruler colors come from custom properties (canvas.css), so the theme stays in CSS. Read once per draw. */
function readPalette(el: HTMLElement): Palette {
  const css = getComputedStyle(el);
  const get = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    background: get('--gl-bg-ruler', '#2f2f31'),
    major: get('--gl-ruler-major', '#8a8a8e'),
    mid: get('--gl-ruler-mid', '#7a7a7e'),
    minor: get('--gl-ruler-minor', '#6c6c70'),
    label: get('--gl-ruler-label', '#9a9a9e'),
  };
}

const TICK_LENGTH: Record<Tick['level'], number> = { 0: RULER_SIZE, 1: 9, 2: 5 };

/** Draws one ruler and returns the labels it shows (also exposed as `data-labels` so tests can read what is on a canvas). */
function drawRuler(canvas: HTMLCanvasElement, orientation: 'top' | 'left', length: number, origin: number, zoom: number, units: DisplayUnits): string[] {
  const dpr = window.devicePixelRatio || 1;
  const width = orientation === 'top' ? length : RULER_SIZE;
  const height = orientation === 'top' ? RULER_SIZE : length;
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return [];
  const palette = readPalette(canvas);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = palette.background;
  ctx.fillRect(0, 0, width, height);

  const fromPt = (0 - origin) / zoom;
  const toPt = (length - origin) / zoom;
  ctx.font = '8px -apple-system, "SF Pro Text", "Helvetica Neue", Arial, sans-serif';
  ctx.textBaseline = 'alphabetic';
  ctx.lineWidth = 1;
  const labels: string[] = [];
  for (const tick of rulerTicks(fromPt, toPt, zoom, units)) {
    const pos = Math.round(origin + tick.pt * zoom) + 0.5;
    if (pos < -1 || pos > length + 1) continue;
    ctx.strokeStyle = tick.level === 0 ? palette.major : tick.level === 1 ? palette.mid : palette.minor;
    ctx.beginPath();
    if (orientation === 'top') {
      ctx.moveTo(pos, RULER_SIZE - TICK_LENGTH[tick.level]);
      ctx.lineTo(pos, RULER_SIZE);
    } else {
      ctx.moveTo(RULER_SIZE - TICK_LENGTH[tick.level], pos);
      ctx.lineTo(RULER_SIZE, pos);
    }
    ctx.stroke();
    if (tick.label !== undefined) {
      labels.push(tick.label);
      ctx.fillStyle = palette.label;
      if (orientation === 'top') {
        ctx.fillText(tick.label, pos + 3, 11);
      } else {
        // vertical labels read downward from the tick, so four-digit values fit the 18 px ruler
        ctx.save();
        ctx.translate(2, pos + 3);
        ctx.rotate(Math.PI / 2);
        ctx.fillText(tick.label, 0, 0);
        ctx.restore();
      }
    }
  }
  return labels;
}

interface RulersProps {
  size: Size;
  view: ViewTransform;
  units: DisplayUnits;
}

/**
 * The two rulers and the corner square. They are chrome in the canvas: the origin is the current page's top-left (page point
 * 0, 0), so the labels read the same coordinates the model stores, in the chosen units. Dragging from a ruler creates a
 * guide (the pointer handling is in Canvas.tsx, keyed on `data-ruler`).
 */
export function Rulers({ size, view, units }: RulersProps) {
  const top = useRef<HTMLCanvasElement>(null);
  const left = useRef<HTMLCanvasElement>(null);

  useLayoutEffect(() => {
    if (top.current) top.current.dataset.labels = drawRuler(top.current, 'top', size.width, view.panX, view.zoom, units).join(' ');
    if (left.current) left.current.dataset.labels = drawRuler(left.current, 'left', size.height, view.panY, view.zoom, units).join(' ');
  }, [size.width, size.height, view.panX, view.panY, view.zoom, units]);

  return (
    <>
      <canvas ref={top} className="gl-ruler gl-ruler-top" data-ruler="top" data-testid="ruler-top" data-units={units} style={{ width: size.width, height: RULER_SIZE }} />
      <canvas ref={left} className="gl-ruler gl-ruler-left" data-ruler="left" data-testid="ruler-left" data-units={units} style={{ width: RULER_SIZE, height: size.height }} />
      <div className="gl-ruler-corner" />
    </>
  );
}
