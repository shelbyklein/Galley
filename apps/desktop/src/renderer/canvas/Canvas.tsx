/**
 * Editor canvas: the pasteboard, the page(s) drawn by @galley/render, and the interaction overlay.
 * Lane B owns this folder (viewport, rulers, selection, tools). Placeholder for now.
 */
export function Canvas() {
  return <span className="gl-region-label" style={{ position: 'absolute', top: 12, left: 12 }}>Canvas</span>;
}
