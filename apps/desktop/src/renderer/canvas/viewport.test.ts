import { makePage } from '@galley/model';
import { describe, expect, it } from 'vitest';
import { centerPageAt, clampZoom, fitPage, formatZoom, MAX_ZOOM, MIN_ZOOM, pageToView, stepZoom, viewToPage, zoomAt, zoomToRect } from './viewport';

describe('zoom steps', () => {
  it('steps through the InDesign presets', () => {
    expect(stepZoom(1, 'in')).toBe(1.25);
    expect(stepZoom(1, 'out')).toBe(0.75);
    expect(stepZoom(0.5, 'in')).toBeCloseTo(2 / 3, 10);
    expect(stepZoom(4, 'in')).toBe(6);
  });

  it('goes to the next preset from an arbitrary fit zoom', () => {
    expect(stepZoom(0.6342, 'in')).toBeCloseTo(2 / 3, 10);
    expect(stepZoom(0.6342, 'out')).toBe(0.5);
    // a zoom within rounding error of a preset counts as being at it
    expect(stepZoom(0.4999999999, 'in')).toBeCloseTo(2 / 3, 10);
    expect(stepZoom(0.5000000001, 'out')).toBe(0.3333333333333333);
  });

  it('stops at both ends', () => {
    expect(stepZoom(MAX_ZOOM, 'in')).toBe(MAX_ZOOM);
    expect(stepZoom(MIN_ZOOM, 'out')).toBe(MIN_ZOOM);
    expect(clampZoom(1000)).toBe(MAX_ZOOM);
    expect(clampZoom(0)).toBe(MIN_ZOOM);
  });

  it('formats the readout', () => {
    expect(formatZoom(1)).toBe('100%');
    expect(formatZoom(2 / 3)).toBe('66.7%');
    expect(formatZoom(0.5)).toBe('50%');
    expect(formatZoom(40)).toBe('4000%');
  });
});

describe('view transforms', () => {
  const v = { zoom: 2, panX: 30, panY: -10 };

  it('converts page to view and back', () => {
    expect(pageToView(v, { x: 10, y: 5 })).toEqual({ x: 50, y: 0 });
    expect(viewToPage(v, { x: 50, y: 0 })).toEqual({ x: 10, y: 5 });
  });

  it('zooming at a point keeps the page point under it fixed', () => {
    const focal = { x: 200, y: 120 };
    const before = viewToPage(v, focal);
    const next = zoomAt(v, 3.5, focal);
    expect(next.zoom).toBe(3.5);
    const after = viewToPage(next, focal);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });

  it('fits a page centered with padding, using whole-pixel pan', () => {
    const page = makePage({ width: 612, height: 792 });
    const fit = fitPage({ width: 1078, height: 782 }, page);
    expect(fit.zoom).toBeCloseTo((782 - 48) / 792, 10);
    expect(Number.isInteger(fit.panX) && Number.isInteger(fit.panY)).toBe(true);
    // the page is centered horizontally within a pixel
    expect(fit.panX + (612 * fit.zoom) / 2).toBeCloseTo(1078 / 2, 0);
  });

  it('fits the whole sheet, bleed and slug included', () => {
    const page = makePage({ width: 100, height: 100, bleed: 10, slug: 20 });
    const fit = fitPage({ width: 340, height: 340 }, page, 20);
    // sheet is 140 x 140; the trim origin sits 20 pt inside the sheet
    expect(fit.zoom).toBeCloseTo(300 / 140, 10);
    expect(fit.panX).toBe(Math.round(20 + 20 * fit.zoom));
  });

  it('centers the page at a chosen zoom', () => {
    const page = makePage({ width: 600, height: 800 });
    expect(centerPageAt({ width: 1000, height: 1000 }, page, 1)).toEqual({ zoom: 1, panX: 200, panY: 100 });
  });

  it('zooms to a rectangle', () => {
    const view = zoomToRect({ width: 800, height: 600 }, { x: 100, y: 100, w: 200, h: 100 }, 0);
    expect(view.zoom).toBe(4);
    expect(pageToView(view, { x: 200, y: 150 })).toEqual({ x: 400, y: 300 });
  });
});
