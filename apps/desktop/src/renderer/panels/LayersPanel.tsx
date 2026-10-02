import {
  addLayer,
  createId,
  makeLayer,
  moveLayer,
  removeLayer,
  setLayerProps,
  type Frame,
  type GalleyDocument,
  type Id,
  type Layer,
} from '@galley/model';
import { useEffect, useRef, useState } from 'react';
import { selectDoc, useEditorStore } from '../store';
import { Icon } from '../shell/Icon';
import { FooterButton, Panel } from './Panel';
import { useReorder } from './useReorder';

/** The colors layers cycle through, as the colors of selection handles on that layer. The first is the default. */
export const LAYER_COLORS: readonly { name: string; hex: string }[] = [
  { name: 'Light Blue', hex: '#4da3ff' },
  { name: 'Red', hex: '#ff453a' },
  { name: 'Green', hex: '#32d74b' },
  { name: 'Yellow', hex: '#ffd60a' },
  { name: 'Magenta', hex: '#e040fb' },
  { name: 'Cyan', hex: '#31c4f3' },
  { name: 'Orange', hex: '#ff9f0a' },
  { name: 'Violet', hex: '#8e7cff' },
  { name: 'Gray', hex: '#98989d' },
];

/** `Layer 2`: the first "Layer n" not in use. */
export function nextLayerName(doc: GalleyDocument): string {
  const used = new Set(Object.values(doc.layers).map((l) => l.name));
  for (let n = Object.keys(doc.layers).length + 1; ; n++) if (!used.has(`Layer ${n}`)) return `Layer ${n}`;
}

/** The first palette color no layer uses yet, cycling when all are taken. */
export function nextLayerColor(doc: GalleyDocument): string {
  const used = new Set(Object.values(doc.layers).map((l) => l.color.toLowerCase()));
  const free = LAYER_COLORS.find((c) => !used.has(c.hex));
  return (free ?? LAYER_COLORS[Object.keys(doc.layers).length % LAYER_COLORS.length]!).hex;
}

/** New layer above the active one; it becomes active. */
export function newLayer(): void {
  const store = useEditorStore.getState();
  const doc = selectDoc(store);
  const above = store.activeLayerId ? doc.layerOrder.indexOf(store.activeLayerId) : doc.layerOrder.length - 1;
  const layer = makeLayer({ id: createId('layer'), name: nextLayerName(doc), color: nextLayerColor(doc) });
  store.dispatch(addLayer, { layer, index: above + 1 });
  useEditorStore.getState().setActiveLayer(layer.id);
}

export function deleteActiveLayer(): void {
  const store = useEditorStore.getState();
  const doc = selectDoc(store);
  const id = store.activeLayerId;
  if (!id || doc.layerOrder.length <= 1) return;
  store.dispatch(removeLayer, { id });
}

/** Move the active layer up (+1, toward the top of the stack) or down (-1). */
export function moveActiveLayer(delta: -1 | 1): void {
  const store = useEditorStore.getState();
  const doc = selectDoc(store);
  const id = store.activeLayerId;
  if (!id) return;
  const to = doc.layerOrder.indexOf(id) + delta;
  if (to < 0 || to >= doc.layerOrder.length) return;
  store.dispatch(moveLayer, { id, index: to });
}

/** The name the Layers panel shows for an object: `<photo.jpg>`, `<Twenty studios open...>`, `<Ellipse>`. */
export function frameLabel(doc: GalleyDocument, frame: Frame): string {
  if (frame.name) return `<${frame.name}>`;
  switch (frame.type) {
    case 'image': {
      const asset = frame.assetId ? doc.assets[frame.assetId] : undefined;
      return asset ? `<${asset.path.split('/').pop()}>` : '<Graphic Frame>';
    }
    case 'text': {
      const story = doc.stories[frame.storyId];
      const text = (story?.doc.content ?? []).map((p) => (p.content ?? []).map((n) => n.text ?? '').join('')).join(' ').trim();
      if (!text) return '<Text Frame>';
      return `<${text.length > 26 ? `${text.slice(0, 26)}…` : text}>`;
    }
    case 'rect':
      return '<Rectangle>';
    case 'ellipse':
      return '<Ellipse>';
    case 'line':
      return '<Line>';
    case 'group':
      return '<Group>';
  }
}

interface ObjectRow {
  id: Id;
  depth: number;
}

/** The objects of one layer on one page, topmost first, with a group's children indented beneath it. */
export function layerObjects(doc: GalleyDocument, pageId: Id, layerId: Id): ObjectRow[] {
  const rows: ObjectRow[] = [];
  const visit = (id: Id, depth: number) => {
    const f = doc.frames[id];
    if (!f) return;
    rows.push({ id, depth });
    if (f.type === 'group') [...f.childIds].reverse().forEach((c) => visit(c, depth + 1));
  };
  const page = doc.pages[pageId];
  if (!page) return rows;
  [...page.items].reverse().filter((id) => doc.frames[id]?.layerId === layerId).forEach((id) => visit(id, 0));
  return rows;
}

/**
 * Layers panel: layers topmost first, each with an eye (hide: its frames are not drawn), a lock (its frames cannot be
 * selected), a disclosure triangle listing its objects, a color chip and a name (double-click to rename). Drag a layer
 * to reorder it. Clicking an object selects it.
 */
export function LayersPanel() {
  const doc = useEditorStore(selectDoc);
  const selection = useEditorStore((s) => s.selection);
  const currentPageId = useEditorStore((s) => s.currentPageId);
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  const [collapsed, setCollapsed] = useState<ReadonlySet<Id>>(new Set());
  const [editing, setEditing] = useState<Id | null>(null);
  const topFirst = [...doc.layerOrder].reverse();
  const count = topFirst.length;
  const reorder = useReorder({
    axis: 'y',
    onMove: (from, to) => {
      const ids = [...doc.layerOrder].reverse();
      // display index d (0 = top) is model index count - 1 - d
      useEditorStore.getState().dispatch(moveLayer, { id: ids[from]!, index: count - 1 - to });
    },
  });
  const activeIndex = activeLayerId ? doc.layerOrder.indexOf(activeLayerId) : -1;
  const objectCount = Object.keys(doc.frames).length;

  return (
    <Panel
      id="layers"
      menu={[
        { label: 'New Layer', onSelect: newLayer },
        { label: 'Delete Layer', onSelect: deleteActiveLayer, disabled: count <= 1 },
        { label: 'Move Layer Up', onSelect: () => moveActiveLayer(1), disabled: activeIndex < 0 || activeIndex >= count - 1 },
        { label: 'Move Layer Down', onSelect: () => moveActiveLayer(-1), disabled: activeIndex <= 0 },
      ]}
      footer={
        <>
          <span className="gl-panel-note" data-testid="layers-summary">
            Page: {doc.pageOrder.indexOf(currentPageId) + 1}, {count} {count === 1 ? 'Layer' : 'Layers'}
          </span>
          <span className="gl-footer-spacer" />
          <FooterButton label="New Layer" onClick={newLayer} testId="layers-new">
            <Icon name="plus" size={14} />
          </FooterButton>
          <FooterButton label="Delete Layer" onClick={deleteActiveLayer} disabled={count <= 1} testId="layers-delete">
            <Icon name="trash" size={14} />
          </FooterButton>
        </>
      }
    >
      <div className="gl-layers" ref={reorder.containerRef} data-object-count={objectCount}>
        {topFirst.map((id, i) => {
          const layer = doc.layers[id]!;
          const objects = collapsed.has(id) ? [] : layerObjects(doc, currentPageId, id);
          return (
            <div key={id} className="gl-layer-group" data-layer-group={id}>
              <LayerRow
                layer={layer}
                index={i}
                active={id === activeLayerId}
                collapsed={collapsed.has(id)}
                editing={editing === id}
                dropTarget={reorder.drag?.over === i && reorder.drag.from !== i}
                dragging={reorder.drag?.from === i}
                onPointerDown={reorder.start(i)}
                onActivate={() => !reorder.wasDragged() && useEditorStore.getState().setActiveLayer(id)}
                onToggleCollapsed={() => setCollapsed((c) => { const n = new Set(c); if (n.has(id)) n.delete(id); else n.add(id); return n; })}
                onEdit={(on) => setEditing(on ? id : null)}
              />
              {objects.map((row) => (
                <ObjectRowView key={row.id} doc={doc} id={row.id} depth={row.depth} layer={layer} selected={selection.includes(row.id)} />
              ))}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

function LayerRow({
  layer,
  index,
  active,
  collapsed,
  editing,
  dropTarget,
  dragging,
  onPointerDown,
  onActivate,
  onToggleCollapsed,
  onEdit,
}: {
  layer: Layer;
  index: number;
  active: boolean;
  collapsed: boolean;
  editing: boolean;
  dropTarget: boolean;
  dragging: boolean;
  onPointerDown: React.PointerEventHandler;
  onActivate(): void;
  onToggleCollapsed(): void;
  onEdit(on: boolean): void;
}) {
  const [palette, setPalette] = useState(false);
  const set = (props: Partial<Pick<Layer, 'name' | 'color' | 'visible' | 'locked'>>) =>
    useEditorStore.getState().dispatch(setLayerProps, { id: layer.id, props });
  const classes = ['gl-layer-row', active ? 'is-active' : '', layer.visible ? '' : 'is-hidden', layer.locked ? 'is-locked' : '', dropTarget ? 'is-drop-target' : '', dragging ? 'is-dragging' : '']
    .filter(Boolean)
    .join(' ');
  return (
    <>
    <div
      className={classes}
      data-layer-id={layer.id}
      data-reorder-index={index}
      data-visible={layer.visible}
      data-locked={layer.locked}
      onPointerDown={onPointerDown}
      onClick={onActivate}
    >
      <button type="button" className={`gl-layer-eye${layer.visible ? '' : ' is-off'}`} aria-label={layer.visible ? 'Hide layer' : 'Show layer'} aria-pressed={layer.visible} data-action="visibility" onClick={(e) => { e.stopPropagation(); set({ visible: !layer.visible }); }}>
        <Icon name="eye" size={14} />
      </button>
      <button type="button" className={`gl-layer-lock${layer.locked ? ' is-on' : ''}`} aria-label={layer.locked ? 'Unlock layer' : 'Lock layer'} aria-pressed={layer.locked} data-action="lock" onClick={(e) => { e.stopPropagation(); set({ locked: !layer.locked }); }}>
        <Icon name={layer.locked ? 'lock' : 'lock-open'} size={14} />
      </button>
      <button type="button" className="gl-layer-disclosure" aria-label={collapsed ? 'Show objects' : 'Hide objects'} aria-expanded={!collapsed} data-action="disclosure" onClick={(e) => { e.stopPropagation(); onToggleCollapsed(); }}>
        <Icon name={collapsed ? 'caret-right' : 'caret-down'} size={12} />
      </button>
      <span className="gl-layer-color-wrap">
        <button type="button" className="gl-layer-color" style={{ background: layer.color }} aria-label="Layer color" data-action="color" onClick={(e) => { e.stopPropagation(); setPalette(!palette); }} />
      </span>
      {editing ? (
        <RenameInput
          name={layer.name}
          onDone={(name) => {
            onEdit(false);
            if (name !== null && name.trim() !== '' && name !== layer.name) set({ name: name.trim() });
          }}
        />
      ) : (
        <span className="gl-layer-name" data-testid="layer-name" onDoubleClick={() => onEdit(true)}>
          {layer.name}
        </span>
      )}
    </div>
    {palette && <ColorPalette current={layer.color} onPick={(hex) => { set({ color: hex }); setPalette(false); }} onClose={() => setPalette(false)} />}
    </>
  );
}

function RenameInput({ name, onDone }: { name: string; onDone(name: string | null): void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(name);
  const finished = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (value: string | null) => {
    if (finished.current) return;
    finished.current = true;
    onDone(value);
  };
  return (
    <input
      ref={ref}
      className="gl-layer-rename"
      data-testid="layer-rename"
      value={text}
      spellCheck={false}
      onChange={(e) => setText(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onBlur={() => finish(text)}
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && /^[acvxz]$/i.test(e.key)) e.stopPropagation();
        if (e.key === 'Enter') finish(text);
        else if (e.key === 'Escape') {
          e.stopPropagation();
          finish(null);
        }
      }}
    />
  );
}

function ColorPalette({ current, onPick, onClose }: { current: string; onPick(hex: string): void; onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('[data-action="color"]')) return; // the chip toggles the palette itself
      if (ref.current && !ref.current.contains(target)) onClose();
    };
    window.addEventListener('mousedown', away);
    return () => window.removeEventListener('mousedown', away);
  }, [onClose]);
  return (
    <div className="gl-palette-row" ref={ref} role="listbox" aria-label="Layer color" data-testid="layer-palette" onClick={(e) => e.stopPropagation()}>
      {LAYER_COLORS.map((c) => (
        <button key={c.hex} type="button" role="option" aria-selected={c.hex === current.toLowerCase()} className={`gl-palette-swatch${c.hex === current.toLowerCase() ? ' is-current' : ''}`} style={{ background: c.hex }} title={c.name} data-color={c.hex} onClick={() => onPick(c.hex)} />
      ))}
    </div>
  );
}

function ObjectRowView({ doc, id, depth, layer, selected }: { doc: GalleyDocument; id: Id; depth: number; layer: Layer; selected: boolean }) {
  const frame = doc.frames[id]!;
  const blocked = !layer.visible || layer.locked;
  return (
    <div
      className={`gl-object-row${selected ? ' is-selected' : ''}${blocked ? ' is-blocked' : ''}`}
      data-object-id={id}
      data-selected={selected}
      style={{ paddingLeft: 40 + depth * 12 }}
      onClick={(e) => {
        const store = useEditorStore.getState();
        if (e.shiftKey || e.metaKey) store.toggleSelection(id);
        else store.setSelection([id]);
      }}
    >
      <span className="gl-object-label">{frameLabel(doc, frame)}</span>
      {selected && <span className="gl-object-marker" style={{ background: layer.color }} />}
    </div>
  );
}
