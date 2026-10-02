import { Canvas } from '../canvas';
import { DialogHost } from '../dialogs';
import { ControlStrip } from './control-strip/ControlStrip';
import { Dock } from './Dock';
import { Notices } from './Notices';
import { StatusBar } from './StatusBar';
import { TitleBar } from './TitleBar';
import { ToolsPanel } from './ToolsPanel';
import './shell.css';

/**
 * The editor shell: four content regions around the canvas.
 *
 *   +---------------- title bar ----------------+
 *   +-------------- control strip -------------+
 *   | tools |        canvas        |    dock    |
 *   +----------------- status bar -------------+
 *
 * The `data-region` hooks on the wrappers are what e2e tests (and the smoke screenshot) key on, so they live here,
 * not in the region components that lanes B and C rework. Notices float over the canvas region; dialogs over everything.
 */
export function Shell() {
  return (
    <div className="gl-shell" data-testid="shell">
      <header className="gl-titlebar" data-region="titlebar">
        <TitleBar />
      </header>
      <section className="gl-control-strip" data-region="control-strip">
        <ControlStrip />
      </section>
      <aside className="gl-tools" data-region="tools">
        <ToolsPanel />
      </aside>
      <main className="gl-canvas" data-region="canvas">
        <Canvas />
        <Notices />
      </main>
      <aside className="gl-dock" data-region="dock">
        <Dock />
      </aside>
      <footer className="gl-statusbar" data-region="statusbar">
        <StatusBar />
      </footer>
      <DialogHost />
    </div>
  );
}
