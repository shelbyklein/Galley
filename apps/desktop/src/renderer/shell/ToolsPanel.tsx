import { commands } from '../commands/registry';
import { formatShortcut } from '../commands/shortcuts';
import { selectDoc, useEditorStore } from '../store';
import { TOOLS } from './commands';
import { Icon, type IconName } from './Icon';
import { PaintChip, useScreenColors } from './PaintChip';
import { leafFrames, summarizePaint } from './paintTargets';
import { useShellStore } from './shellStore';

const TOOL_ICONS: Record<string, IconName> = {
  'tool.selection': 'tool-select',
  'tool.type': 'tool-type',
  'tool.line': 'tool-line',
  'tool.rectangleFrame': 'tool-frame',
  'tool.rectangle': 'tool-rect',
  'tool.ellipse': 'tool-ellipse',
  'tool.hand': 'tool-hand',
  'tool.zoom': 'tool-zoom',
};

/**
 * Tools column (left): one button per tool command, the active one highlighted, and the fill/stroke proxy below.
 * The buttons run the registered `tool.*` commands, so a button, a shortcut and a menu item all take one path. The
 * Direct Selection tool (A) is drawn but disabled: direct selection is outside Phase 1.
 */
export function ToolsPanel() {
  const activeTool = useEditorStore((s) => s.activeTool);
  return (
    <div className="gl-tools-list" role="toolbar" aria-label="Tools" aria-orientation="vertical">
      {TOOLS.map((t, i) => (
        <div key={t.id} className="gl-tool-slot">
          {i === 1 && (
            <button type="button" className="gl-tool-button" disabled title="Direct Selection Tool (A): not available yet" data-tool="direct-selection" aria-label="Direct Selection Tool">
              <Icon name="tool-direct" size={20} />
            </button>
          )}
          <button
            type="button"
            className={`gl-tool-button${activeTool === t.tool ? ' is-active' : ''}`}
            data-tool={t.tool}
            data-command={t.id}
            aria-pressed={activeTool === t.tool}
            aria-label={t.label}
            title={`${t.label} (${formatShortcut(t.shortcut)})`}
            onClick={() => void commands.execute(t.id)}
          >
            <Icon name={TOOL_ICONS[t.id]!} size={20} />
          </button>
        </div>
      ))}
      <div className="gl-tools-divider" />
      <FillStrokeProxy />
    </div>
  );
}

/**
 * The fill/stroke proxy: two overlapping squares showing the selection's fill (front) and stroke (back). Clicking one
 * makes it the target that swatch clicks apply to; X toggles the target and Shift+X swaps the two paints.
 */
function FillStrokeProxy() {
  const target = useShellStore((s) => s.proxyTarget);
  const setTarget = useShellStore((s) => s.setProxyTarget);
  const doc = useEditorStore(selectDoc);
  const selection = useEditorStore((s) => s.selection);
  const colors = useScreenColors();
  const leaves = leafFrames(doc, selection);
  const fill = summarizePaint(doc, leaves, 'fill');
  const stroke = summarizePaint(doc, leaves, 'stroke');
  const toPaint = (s: ReturnType<typeof summarizePaint>) => (s.kind === 'paint' ? s.paint : null);
  return (
    <div className="gl-proxy" data-testid="fill-stroke-proxy" data-target={target} title="Fill and Stroke (X toggles, Shift+X swaps)">
      <button
        type="button"
        className={`gl-proxy-stroke${target === 'stroke' ? ' is-target' : ''}`}
        data-proxy="stroke"
        aria-pressed={target === 'stroke'}
        aria-label="Stroke"
        onClick={() => setTarget('stroke')}
      >
        <PaintChip paint={toPaint(stroke)} colors={colors} size={22} outline />
      </button>
      <button
        type="button"
        className={`gl-proxy-fill${target === 'fill' ? ' is-target' : ''}`}
        data-proxy="fill"
        aria-pressed={target === 'fill'}
        aria-label="Fill"
        onClick={() => setTarget('fill')}
      >
        <PaintChip paint={toPaint(fill)} colors={colors} size={20} />
      </button>
    </div>
  );
}
