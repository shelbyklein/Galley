import { addSwatch, createId, isBuiltinSwatch, removeSwatch, type GalleyDocument, type Id, type Swatch } from '@galley/model';
import { selectDoc, useEditorStore } from '../store';
import { Field } from '../shell/control-strip/Field';
import { parsePercent, trimNumber } from '../shell/control-strip/units';
import { Icon } from '../shell/Icon';
import { PaintChip, useScreenColors } from '../shell/PaintChip';
import { applySwatch, leafFrames, summarizePaint } from '../shell/paintTargets';
import { useShellStore } from '../shell/shellStore';
import { FooterButton, Panel } from './Panel';

/** `C0 M60 Y100 K0` for a process or spot swatch, `Studio Blue 60%` for a tint. */
export function swatchDetail(doc: GalleyDocument, s: Swatch): string {
  if (s.type === 'tint') {
    const base = doc.swatches[s.baseId];
    return `${base?.name ?? '?'} ${trimNumber(s.percent, 1)}%`;
  }
  const [c, m, y, k] = s.values.map((v) => trimNumber(v, 1));
  return `C${c} M${m} Y${y} K${k}`;
}

/** A name for a new tint swatch: `Studio Blue 60%`, numbered if that exists. */
function tintName(doc: GalleyDocument, base: Swatch, percent: number): string {
  const used = new Set(Object.values(doc.swatches).map((s) => s.name));
  const name = `${base.name} ${trimNumber(percent, 1)}%`;
  if (!used.has(name)) return name;
  for (let n = 2; ; n++) if (!used.has(`${name} ${n}`)) return `${name} ${n}`;
}

/** New Tint Swatch: a saved tint of the highlighted swatch (or of its base, when that is itself a tint) at the panel's tint. */
export function newTintSwatch(): void {
  const store = useEditorStore.getState();
  const doc = selectDoc(store);
  const shell = useShellStore.getState();
  const selected = shell.selectedSwatchId ? doc.swatches[shell.selectedSwatchId] : undefined;
  if (!selected) return;
  const base = selected.type === 'tint' ? doc.swatches[selected.baseId] : selected;
  if (!base) return;
  const swatch: Swatch = { id: createId('swatch'), type: 'tint', name: tintName(doc, base, shell.tint), baseId: base.id, percent: shell.tint };
  store.dispatch(addSwatch, { swatch });
  useShellStore.getState().setSelectedSwatch(swatch.id);
}

export function deleteSelectedSwatch(): void {
  const shell = useShellStore.getState();
  const id = shell.selectedSwatchId;
  if (!id || isBuiltinSwatch(id)) return;
  useEditorStore.getState().dispatch(removeSwatch, { id });
  useShellStore.getState().setSelectedSwatch(null);
}

/**
 * Swatches panel: [None] and the document's swatches (process squares, spot circles, tints), a tint field, and New /
 * New Tint / Delete in the footer. Clicking a swatch applies it, at the panel's tint, to the fill or stroke of the
 * selection (whichever the proxy has as its target); double-click edits it. Changing the tint re-applies the target's
 * current swatch at the new tint.
 */
export function SwatchesPanel() {
  const doc = useEditorStore(selectDoc);
  const selection = useEditorStore((s) => s.selection);
  const colors = useScreenColors();
  const tint = useShellStore((s) => s.tint);
  const setTint = useShellStore((s) => s.setTint);
  const selectedId = useShellStore((s) => s.selectedSwatchId);
  const setSelected = useShellStore((s) => s.setSelectedSwatch);
  const target = useShellStore((s) => s.proxyTarget);
  const openDialog = useShellStore((s) => s.openDialog);

  const leaves = leafFrames(doc, selection);
  const current = summarizePaint(doc, leaves, target);
  const selectedSwatch = selectedId ? doc.swatches[selectedId] : undefined;

  const pick = (id: Id | null) => {
    setSelected(id);
    applySwatch(target, id, id === null ? 100 : tint);
  };
  const commitTint = (text: string): boolean => {
    const v = parsePercent(text);
    if (v === null) return false;
    const next = Math.min(100, Math.max(0, v));
    setTint(next);
    // the tint field also retints the target's current swatch, as in InDesign
    if (current.kind === 'paint') applySwatch(target, current.paint.swatchId, next);
    return true;
  };

  return (
    <Panel
      id="swatches"
      menu={[
        { label: 'New Swatch…', onSelect: () => openDialog({ kind: 'swatch', swatchId: null }) },
        { label: 'New Tint Swatch', onSelect: newTintSwatch, disabled: !selectedSwatch },
        { label: 'Swatch Options…', onSelect: () => selectedId && openDialog({ kind: 'swatch', swatchId: selectedId }), disabled: !selectedSwatch },
        { label: 'Delete Swatch', onSelect: deleteSelectedSwatch, disabled: !selectedSwatch || isBuiltinSwatch(selectedSwatch.id) },
      ]}
      footer={
        <>
          <span className="gl-footer-spacer" />
          <FooterButton label="New Swatch" onClick={() => openDialog({ kind: 'swatch', swatchId: null })} testId="swatches-new">
            <Icon name="plus" size={14} />
          </FooterButton>
          <FooterButton label="New Tint Swatch" onClick={newTintSwatch} disabled={!selectedSwatch} testId="swatches-new-tint">
            <Icon name="tint" size={14} />
          </FooterButton>
          <FooterButton label="Delete Swatch" onClick={deleteSelectedSwatch} disabled={!selectedSwatch || isBuiltinSwatch(selectedSwatch.id)} testId="swatches-delete">
            <Icon name="trash" size={14} />
          </FooterButton>
        </>
      }
    >
      <div className="gl-tint-row">
        <span className="gl-tint-label">Tint:</span>
        <Field name="tint" value={`${trimNumber(tint, 1)} %`} width={64} onCommit={commitTint} title="Tint of the swatch applied to the selection" />
      </div>
      <div className="gl-swatch-list" role="listbox" aria-label="Swatches">
        <SwatchRow id={null} name="[None]" detail="" selected={false} onPick={() => pick(null)} onEdit={() => {}} colors={colors} icon={null} />
        {doc.swatchOrder.map((id) => {
          const s = doc.swatches[id]!;
          return (
            <SwatchRow
              key={id}
              id={id}
              name={s.name}
              detail={swatchDetail(doc, s)}
              selected={selectedId === id}
              applied={current.kind === 'paint' && (current.paint.swatchId === id)}
              onPick={() => pick(id)}
              onEdit={() => openDialog({ kind: 'swatch', swatchId: id })}
              colors={colors}
              icon={s.type === 'spot' ? 'spot' : s.type === 'tint' ? 'tint' : 'process'}
              builtin={isBuiltinSwatch(id)}
            />
          );
        })}
      </div>
    </Panel>
  );
}

function SwatchRow({
  id,
  name,
  detail,
  selected,
  applied,
  onPick,
  onEdit,
  colors,
  icon,
  builtin,
}: {
  id: Id | null;
  name: string;
  detail: string;
  selected: boolean;
  applied?: boolean;
  onPick(): void;
  onEdit(): void;
  colors: ReturnType<typeof useScreenColors>;
  icon: 'spot' | 'tint' | 'process' | null;
  builtin?: boolean;
}) {
  return (
    <div
      className={`gl-swatch-row${selected ? ' is-selected' : ''}${applied ? ' is-applied' : ''}`}
      role="option"
      aria-selected={selected}
      data-swatch-id={id ?? 'none'}
      data-builtin={builtin ?? false}
      onClick={onPick}
      onDoubleClick={onEdit}
    >
      <PaintChip paint={id === null ? null : { swatchId: id, tint: 100, overprint: false }} colors={colors} size={14} />
      <span className="gl-swatch-name">{name}</span>
      {detail && <span className="gl-swatch-detail">{detail}</span>}
      {icon && <Icon name={icon} size={12} className="gl-swatch-kind" />}
    </div>
  );
}
