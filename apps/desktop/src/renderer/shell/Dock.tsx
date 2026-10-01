import { LayersPanel, PagesPanel, SwatchesPanel } from '../panels';

/**
 * Right dock hosting the collapsible panels: Pages, Layers, Swatches (lane C), and later the panels lanes S and T add.
 * Each panel is built on `Panel` (../panels/Panel.tsx), which owns its header, collapse and visibility.
 */
export function Dock() {
  return (
    <div className="gl-dock-stack" data-testid="dock-stack">
      <PagesPanel />
      <LayersPanel />
      <SwatchesPanel />
    </div>
  );
}
