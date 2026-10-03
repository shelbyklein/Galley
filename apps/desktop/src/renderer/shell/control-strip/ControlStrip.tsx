import { TypeControlStrip } from './type/TypeControlStrip';
import { effectiveImagePpi, moveFrames, setFrameProps, type Frame, type GalleyDocument, type Id } from '@galley/model';
import { useEffect, useMemo, useRef, useState } from 'react';
import { commands } from '../../commands/registry';
import { selectDoc, useEditorStore } from '../../store';
import { Icon } from '../Icon';
import { PaintChip, useScreenColors } from '../PaintChip';
import { applyStrokeWeight, applySwatch, leafFrames, summarizePaint, summarizeWeight } from '../paintTargets';
import { useShellStore, type ProxyTarget } from '../shellStore';
import { Field } from './Field';
import {
  moveRefTo,
  REF_POINTS,
  refPointOf,
  refPointOfRect,
  resizeAboutRef,
  scaleLeaves,
  selectionGeometry,
  type RefPoint,
  type SelectionGeometry,
} from './transform';
import { displayUnit, formatAngle, formatLength, parseAngle, parseLength, trimNumber } from './units';

/**
 * Control strip (top), object mode: reference point, X / Y, W / H, linked proportions, rotation, fill, stroke, stroke
 * weight, the fitting dropdown for image frames, and a one-line description of the selection. Lane S adds the type
 * modes under ./type/ (P2-05).
 *
 * Every field edit is one model command (one undo step) on the current selection. With nothing selected the fields
 * are disabled and empty. X and Y name the position of the reference point, so typing X = 72 with the center
 * reference point puts the frame's center at 72 pt (see ./transform.ts).
 */
export function ControlStrip() {
  const typeMode = useEditorStore((s) => s.activeTool === 'type' || s.textSelection !== null);
  return typeMode ? <TypeControlStrip /> : <ObjectControlStrip />;
}

function ObjectControlStrip() {
  const doc = useEditorStore(selectDoc);
  const selection = useEditorStore((s) => s.selection);
  const geometry = useMemo(() => selectionGeometry(doc, selection), [doc, selection]);
  const leaves = useMemo(() => leafFrames(doc, selection), [doc, selection]);
  const ref = useShellStore((s) => s.refPoint);
  const linked = useShellStore((s) => s.proportionsLinked);
  const unit = displayUnit();

  const none = geometry === null;
  const refPoint = geometry ? (geometry.mode === 'box' ? refPointOf(geometry.box, ref) : refPointOfRect(geometry.box, ref)) : null;
  const single = geometry?.mode === 'box' ? doc.frames[geometry.leafIds[0]!] : undefined;
  const isLine = single?.type === 'line';
  const weightValue = summarizeWeight(doc, leaves);
  // a frame with no stroke shows the weight a new stroke would get
  const weightText = weightValue === 'mixed' || (none && weightValue === null) ? '' : formatLength(weightValue ?? 1, unit);
  const fmt = (pt: number | undefined) => (pt === undefined ? '' : formatLength(pt, unit));

  // ----- commits
  const commitPosition = (axis: 'x' | 'y', text: string): boolean => {
    const v = parseLength(text, unit);
    if (v === null || !geometry) return false;
    const store = useEditorStore.getState();
    if (geometry.mode === 'box') {
      const next = moveRefTo(geometry.box, ref, { [axis]: v });
      store.dispatch(setFrameProps, { ids: geometry.leafIds, props: { x: next.x, y: next.y } });
    } else {
      const here = refPointOfRect(geometry.box, ref);
      const d = v - here[axis];
      store.dispatch(moveFrames, { ids: [...store.selection], dx: axis === 'x' ? d : 0, dy: axis === 'y' ? d : 0 });
    }
    return true;
  };

  const commitSize = (axis: 'w' | 'h', text: string): boolean => {
    const v = parseLength(text, unit);
    if (v === null || v < 0 || !geometry || !geometry.canResize) return false;
    const box = geometry.box;
    let w = box.w;
    let h = box.h;
    if (axis === 'w') {
      w = v;
      if (linked && box.w > 0) h = box.h * (v / box.w);
    } else {
      h = v;
      if (linked && box.h > 0) w = box.w * (v / box.h);
    }
    if (isLine) h = 0;
    const store = useEditorStore.getState();
    if (geometry.mode === 'box') {
      const next = resizeAboutRef(box, ref, { w, h });
      store.dispatch(setFrameProps, { ids: geometry.leafIds, props: { x: next.x, y: next.y, w: next.w, h: next.h } });
    } else {
      const patches = scaleLeaves(doc, geometry, ref, w, h);
      store.beginTransaction('Resize');
      try {
        for (const p of patches) useEditorStore.getState().dispatch(setFrameProps, { ids: [p.id], props: p.props });
      } finally {
        useEditorStore.getState().commitTransaction();
      }
    }
    return true;
  };

  const commitRotation = (text: string): boolean => {
    const deg = parseAngle(text);
    if (deg === null || !geometry || geometry.mode !== 'box') return false;
    const normalized = ((((deg + 180) % 360) + 360) % 360) - 180 || 0; // -180 < r <= 180; 180 stays 180
    const rotation = deg === 180 ? 180 : normalized;
    const next = resizeAboutRef(geometry.box, ref, { rotation });
    useEditorStore.getState().dispatch(setFrameProps, { ids: geometry.leafIds, props: { x: next.x, y: next.y, rotation: next.rotation } });
    return true;
  };

  const commitWeight = (text: string): boolean => {
    const v = parseLength(text, unit);
    if (v === null || v < 0) return false;
    applyStrokeWeight(v);
    return true;
  };

  const step = (axis: 'x' | 'y' | 'w' | 'h' | 'rotation' | 'weight', direction: 1 | -1, big: boolean) => {
    const amount = (big ? 10 : 1) * direction;
    const current = { x: refPoint?.x, y: refPoint?.y, w: geometry?.box.w, h: geometry?.box.h, rotation: geometry?.box.rotation, weight: weightValue ?? 1 };
    const base = current[axis];
    if (base === undefined || base === 'mixed' || base === null) return;
    const text = axis === 'rotation' ? formatAngle(base + amount) : formatLength(base + amount, unit);
    if (axis === 'x' || axis === 'y') commitPosition(axis, text);
    else if (axis === 'w' || axis === 'h') commitSize(axis, text);
    else if (axis === 'rotation') commitRotation(text);
    else commitWeight(text);
  };

  return (
    <div className="gl-cs" data-testid="control-strip-fields" data-mode={none ? 'empty' : geometry.mode}>
      <ReferencePoint disabled={none} />
      <div className="gl-cs-grid">
        <Field name="x" label="X:" value={fmt(refPoint?.x)} disabled={none} onCommit={(t) => commitPosition('x', t)} onStep={(d, b) => step('x', d, b)} />
        <Field name="y" label="Y:" value={fmt(refPoint?.y)} disabled={none} onCommit={(t) => commitPosition('y', t)} onStep={(d, b) => step('y', d, b)} />
      </div>
      <div className="gl-cs-grid">
        <Field name="w" label="W:" value={fmt(geometry?.box.w)} disabled={none || !geometry.canResize} onCommit={(t) => commitSize('w', t)} onStep={(d, b) => step('w', d, b)} />
        <Field name="h" label="H:" value={fmt(geometry?.box.h)} disabled={none || !geometry.canResize || isLine} onCommit={(t) => commitSize('h', t)} onStep={(d, b) => step('h', d, b)} />
      </div>
      <ProportionsToggle disabled={none} />
      <div className="gl-cs-sep" />
      <div className="gl-cs-rotation">
        <Icon name="rotate" size={16} className="gl-cs-icon" />
        <Field
          name="rotation"
          value={geometry ? formatAngle(geometry.box.rotation) : ''}
          disabled={none || !geometry.canRotate}
          width={60}
          title="Rotation angle"
          onCommit={commitRotation}
          onStep={(d, b) => step('rotation', d, b)}
        />
      </div>
      <div className="gl-cs-sep" />
      <PaintControls leaves={leaves} doc={doc} />
      <Field name="weight" value={weightText} disabled={none} width={58} title="Stroke weight" commitUnchanged onCommit={commitWeight} onStep={(d, b) => step('weight', d, b)} />
      <FittingDropdown doc={doc} leaves={leaves} />
      <span className="gl-cs-spacer" />
      <span className="gl-cs-info" data-testid="selection-info">
        {describeSelection(doc, selection, geometry)}
      </span>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ reference point

const REF_NAMES = ['tl', 'tc', 'tr', 'ml', 'c', 'mr', 'bl', 'bc', 'br'];

function ReferencePoint({ disabled }: { disabled: boolean }) {
  const ref = useShellStore((s) => s.refPoint);
  const setRef = useShellStore((s) => s.setRefPoint);
  return (
    <div className="gl-ref" role="radiogroup" aria-label="Reference point" data-testid="reference-point">
      {REF_POINTS.map((p, i) => {
        const active = p.x === ref.x && p.y === ref.y;
        return (
          <button
            key={REF_NAMES[i]}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={`Reference point ${REF_NAMES[i]}`}
            data-ref={REF_NAMES[i]}
            className={`gl-ref-dot${active ? ' is-active' : ''}`}
            disabled={disabled}
            onClick={() => setRef(p as RefPoint)}
          />
        );
      })}
    </div>
  );
}

function ProportionsToggle({ disabled }: { disabled: boolean }) {
  const linked = useShellStore((s) => s.proportionsLinked);
  const set = useShellStore((s) => s.setProportionsLinked);
  return (
    <button
      type="button"
      className={`gl-cs-link${linked ? ' is-on' : ''}`}
      aria-pressed={linked}
      aria-label="Constrain proportions"
      title="Constrain proportions for width and height"
      data-testid="link-proportions"
      disabled={disabled}
      onClick={() => set(!linked)}
    >
      <Icon name="chain" size={14} />
    </button>
  );
}

// ------------------------------------------------------------------------------------------------------ fill and stroke

function PaintControls({ leaves, doc }: { leaves: Id[]; doc: GalleyDocument }) {
  const colors = useScreenColors();
  const target = useShellStore((s) => s.proxyTarget);
  const setTarget = useShellStore((s) => s.setProxyTarget);
  const [open, setOpen] = useState<ProxyTarget | null>(null);
  const fill = summarizePaint(doc, leaves, 'fill');
  const stroke = summarizePaint(doc, leaves, 'stroke');
  const toPaint = (s: ReturnType<typeof summarizePaint>) => (s.kind === 'paint' ? s.paint : null);
  const empty = leaves.length === 0;
  return (
    <>
      <PaintPicker which="fill" label="Fill" open={open === 'fill'} onToggle={() => { setTarget('fill'); setOpen(open === 'fill' ? null : 'fill'); }} onClose={() => setOpen(null)} disabled={empty} active={target === 'fill'}>
        <PaintChip paint={toPaint(fill)} colors={colors} size={18} />
      </PaintPicker>
      <PaintPicker which="stroke" label="Stroke" open={open === 'stroke'} onToggle={() => { setTarget('stroke'); setOpen(open === 'stroke' ? null : 'stroke'); }} onClose={() => setOpen(null)} disabled={empty} active={target === 'stroke'}>
        <PaintChip paint={toPaint(stroke)} colors={colors} size={18} outline />
      </PaintPicker>
    </>
  );
}

function PaintPicker({
  which,
  label,
  open,
  onToggle,
  onClose,
  disabled,
  active,
  children,
}: {
  which: ProxyTarget;
  label: string;
  open: boolean;
  onToggle(): void;
  onClose(): void;
  disabled: boolean;
  active: boolean;
  children: React.ReactNode;
}) {
  const wrapper = useRef<HTMLSpanElement>(null);
  const doc = useEditorStore(selectDoc);
  const colors = useScreenColors();
  const tint = useShellStore((s) => s.tint);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (wrapper.current && !wrapper.current.contains(e.target as Node)) onClose();
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', away);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('mousedown', away);
      window.removeEventListener('keydown', esc);
    };
  }, [open, onClose]);
  return (
    <span className="gl-cs-paint" ref={wrapper}>
      <span className="gl-cs-label">{label}</span>
      <button type="button" className={`gl-cs-chip${active ? ' is-target' : ''}`} data-testid={`${which}-chip`} aria-label={`${label} swatch`} disabled={disabled} onClick={onToggle}>
        {children}
      </button>
      {open && (
        <div className="gl-popover" role="listbox" aria-label={`${label} swatches`} data-testid={`${which}-popover`}>
          <button type="button" className="gl-popover-row" role="option" data-swatch-id="none" onClick={() => { applySwatch(which, null, 100); onClose(); }}>
            <PaintChip paint={null} colors={colors} size={12} />
            <span>[None]</span>
          </button>
          {doc.swatchOrder.map((id) => {
            const s = doc.swatches[id]!;
            return (
              <button key={id} type="button" className="gl-popover-row" role="option" data-swatch-id={id} onClick={() => { applySwatch(which, id, tint); onClose(); }}>
                <PaintChip paint={{ swatchId: id, tint: 100, overprint: false }} colors={colors} size={12} />
                <span>{s.name}</span>
              </button>
            );
          })}
        </div>
      )}
    </span>
  );
}

// -------------------------------------------------------------------------------------------------------------- fitting

const FITTING: readonly { id: string; label: string }[] = [
  { id: 'object.fit.fillProportionally', label: 'Fill Frame Proportionally' },
  { id: 'object.fit.fitProportionally', label: 'Fit Content Proportionally' },
  { id: 'object.fit.contentToFrame', label: 'Fit Content to Frame' },
  { id: 'object.fit.center', label: 'Center Content' },
];

/** The image-frame fitting dropdown: runs lane B's `object.fit.*` commands, and is disabled while none are registered. */
function FittingDropdown({ doc, leaves }: { doc: GalleyDocument; leaves: Id[] }) {
  const allImages = leaves.length > 0 && leaves.every((id) => doc.frames[id]!.type === 'image');
  const [, setTick] = useState(0);
  useEffect(() => commands.subscribe(() => setTick((t) => t + 1)), []);
  if (!allImages) return null;
  const registered = FITTING.filter((f) => commands.has(f.id));
  return (
    <>
      <div className="gl-cs-sep" />
      <label className="gl-cs-fitting">
        <span className="gl-cs-label">Fitting</span>
        <span className="gl-select">
          <select
            data-testid="fitting-dropdown"
            aria-label="Fitting"
            disabled={registered.length === 0}
            value=""
            onChange={(e) => {
              if (e.target.value) void commands.execute(e.target.value);
            }}
          >
            <option value="">{registered.length === 0 ? 'Fitting (not available)' : 'Fitting…'}</option>
            {FITTING.map((f) => (
              <option key={f.id} value={f.id} disabled={!commands.has(f.id) || !commands.isEnabled(f.id)}>
                {f.label}
              </option>
            ))}
          </select>
          <Icon name="caret-down" size={12} className="gl-select-caret" />
        </span>
      </label>
    </>
  );
}

// ------------------------------------------------------------------------------------------------------------ info text

/** `Image frame · photo.jpg · 300 ppi effective`, `Rectangle`, `3 objects`. */
export function describeSelection(doc: GalleyDocument, selection: readonly Id[], geometry: SelectionGeometry | null): string {
  if (!geometry) return '';
  if (selection.length > 1) return `${selection.length} objects`;
  const f = doc.frames[selection[0]!] as Frame | undefined;
  if (!f) return '';
  switch (f.type) {
    case 'image': {
      const asset = f.assetId ? doc.assets[f.assetId] : undefined;
      if (!asset || !f.content) return 'Image frame · empty';
      const ppi = effectiveImagePpi(asset, f)!;
      return `Image frame · ${asset.path.split('/').pop()} · ${trimNumber(ppi.x, 0)}${Math.abs(ppi.x - ppi.y) > 0.5 ? ` × ${trimNumber(ppi.y, 0)}` : ''} ppi effective`;
    }
    case 'text':
      return 'Text frame';
    case 'rect':
      return 'Rectangle';
    case 'ellipse':
      return 'Ellipse';
    case 'line':
      return 'Line';
    case 'group':
      return `Group · ${f.childIds.length} ${f.childIds.length === 1 ? 'object' : 'objects'}`;
  }
}

