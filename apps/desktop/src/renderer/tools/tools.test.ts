import { describe, expect, it } from 'vitest';
import { normalizeTool, resizeCursor } from './tools';

describe('tool ids', () => {
  it('maps the store ids and the command-style names to the same tools', () => {
    expect(normalizeTool('select')).toBe('select');
    expect(normalizeTool('selection')).toBe('select');
    expect(normalizeTool('rectangleFrame')).toBe('rectangle-frame');
    expect(normalizeTool('rectangle-frame')).toBe('rectangle-frame');
    for (const t of ['type', 'line', 'rectangle', 'ellipse', 'hand', 'zoom']) expect(normalizeTool(t)).toBe(t);
    expect(normalizeTool('unknown')).toBe('select');
  });
});

describe('resize cursors', () => {
  it('points along the handle, and turns with the box', () => {
    expect(resizeCursor('e', 0)).toBe('ew-resize');
    expect(resizeCursor('s', 0)).toBe('ns-resize');
    expect(resizeCursor('se', 0)).toBe('nwse-resize');
    expect(resizeCursor('ne', 0)).toBe('nesw-resize');
    // a box turned 90 degrees: its east handle points down the page
    expect(resizeCursor('e', 90)).toBe('ns-resize');
    expect(resizeCursor('se', 45)).toBe('ns-resize');
    expect(resizeCursor('nw', 180)).toBe('nwse-resize');
  });
});
