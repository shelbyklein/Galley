import { addSwatch, CommandError, createId, isBuiltinSwatch, setSwatchProps, type Cmyk, type Id, type Ink, type Swatch } from '@galley/model';
import { defaultSoftProof, getSoftProofEpoch, naiveCmykToRgb, subscribeSoftProof } from '@galley/render';
import { useRef, useState, useSyncExternalStore } from 'react';
import { Field } from '../shell/control-strip/Field';
import { parsePercent, trimNumber } from '../shell/control-strip/units';
import { selectDoc, useEditorStore } from '../store';
import { Modal } from './Modal';

const CHANNELS: readonly { label: string; name: string }[] = [
  { label: 'Cyan', name: 'c' },
  { label: 'Magenta', name: 'm' },
  { label: 'Yellow', name: 'y' },
  { label: 'Black', name: 'k' },
];

/** `New Swatch`, `New Swatch 2`, ... the first name no swatch has. */
function freshName(base: string, swatches: Record<Id, Swatch>): string {
  const used = new Set(Object.values(swatches).map((s) => s.name));
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(`${base} ${n}`)) return `${base} ${n}`;
}

/**
 * New Swatch and Edit Swatch. A new swatch is a CMYK process color or a spot color (its own plate; the CMYK values are
 * its on-screen alternate). Editing changes the name and values; every use of the swatch updates because paints refer
 * to swatches by id. A tint swatch edits its name and percent. The built-in swatches are fixed.
 */
export function SwatchDialog({ swatchId, onDone }: { swatchId: Id | null; onDone(): void }) {
  const doc = useEditorStore(selectDoc);
  const documentGeneration = useRef(useEditorStore.getState().documentGeneration);
  const existing = swatchId ? doc.swatches[swatchId] : undefined;
  const editing = existing !== undefined;
  const [name, setName] = useState(existing?.name ?? freshName('New Swatch', doc.swatches));
  const [type, setType] = useState<'cmyk' | 'spot'>(existing && existing.type !== 'tint' ? existing.type : 'cmyk');
  const [values, setValues] = useState<Cmyk>(existing && existing.type !== 'tint' ? [...existing.values] : [0, 0, 0, 0]);
  const [percent, setPercent] = useState(existing?.type === 'tint' ? existing.percent : 100);
  const [error, setError] = useState('');
  const submitRef = useRef<() => void>(() => {});
  const isTint = existing?.type === 'tint';
  const locked = existing ? isBuiltinSwatch(existing.id) : false;

  const setChannel = (i: number, v: number) => setValues((vs) => vs.map((x, j) => (j === i ? Math.min(100, Math.max(0, v)) : x)) as Cmyk);

  const submit = () => {
    if (useEditorStore.getState().documentGeneration !== documentGeneration.current) { onDone(); return; }
    if (name.trim() === '') {
      setError('A swatch needs a name.');
      return;
    }
    try {
      const store = useEditorStore.getState();
      if (!editing) {
        store.dispatch(addSwatch, { swatch: { id: createId('swatch'), name: name.trim(), type, values } });
      } else if (!locked) {
        const props: { name?: string; values?: Cmyk; percent?: number } = {};
        if (name.trim() !== existing.name) props.name = name.trim();
        if (existing.type !== 'tint' && values.some((v, i) => v !== existing.values[i])) props.values = values;
        if (isTint && percent !== existing.percent) props.percent = percent;
        store.dispatch(setSwatchProps, { id: existing.id, props });
      }
      onDone();
    } catch (e) {
      setError(e instanceof CommandError ? e.message : String(e));
    }
  };
  submitRef.current = submit;
  const enter = () => setTimeout(() => submitRef.current(), 0);

  const base = existing?.type === 'tint' ? doc.swatches[existing.baseId] : undefined;
  useSyncExternalStore(subscribeSoftProof, getSoftProofEpoch);
  const ink: Ink = { swatchId: existing?.id ?? 'draft', name, model: base?.type === 'spot' || type === 'spot' ? 'spot' : 'cmyk', values: base && base.type !== 'tint' ? base.values : values, tint: isTint ? percent : 100, overprint: false };
  const proofed = defaultSoftProof(ink);
  const [r, g, b] = proofed ?? naiveCmykToRgb(ink);
  const preview = `rgb(${r} ${g} ${b})`;

  return (
    <Modal title={editing ? `Swatch Options` : 'New Swatch'} testId="swatch-dialog" okLabel={editing ? 'OK' : 'Add'} okDisabled={locked} onOk={submit} onCancel={onDone} width={400}>
      <div className="gl-form-row">
        <label className="gl-form-label" htmlFor="sw-name">
          Name
        </label>
        <input id="sw-name" className="gl-input" data-field="name" value={name} disabled={locked} spellCheck={false} onChange={(e) => { setName(e.target.value); setError(''); }} onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && /^[acvxz]$/i.test(e.key)) e.stopPropagation(); }} />
        <span className="gl-swatch-preview" style={{ background: preview }} data-testid="swatch-preview" data-proofed={proofed !== undefined} title={proofed ? 'Preview through the output profile' : 'Approximate preview while proofing is unavailable or pending'} />
      </div>
      {!isTint && (
        <>
          <div className="gl-form-row">
            <label className="gl-form-label" htmlFor="sw-type">
              Color type
            </label>
            <select id="sw-type" className="gl-input" data-field="type" value={type} disabled={editing} onChange={(e) => setType(e.target.value as 'cmyk' | 'spot')}>
              <option value="cmyk">Process (CMYK)</option>
              <option value="spot">Spot</option>
            </select>
          </div>
          {CHANNELS.map((c, i) => (
            <div key={c.name} className="gl-form-row gl-channel-row">
              <span className="gl-form-label">{c.label}</span>
              <input type="range" className="gl-slider" min={0} max={100} step={1} value={values[i]} disabled={locked} aria-label={`${c.label} slider`} data-slider={c.name} onChange={(e) => setChannel(i, Number(e.target.value))} />
              <Field className="gl-dialog-field gl-percent-field" name={c.name} value={`${trimNumber(values[i]!, 1)} %`} disabled={locked} onCommit={(t) => { const v = parsePercent(t); if (v === null) return false; setChannel(i, v); }} onEnter={enter} />
            </div>
          ))}
        </>
      )}
      {isTint && (
        <div className="gl-form-row gl-channel-row">
          <span className="gl-form-label">Tint</span>
          <input type="range" className="gl-slider" min={0} max={100} step={1} value={percent} aria-label="Tint slider" data-slider="tint" onChange={(e) => setPercent(Number(e.target.value))} />
          <Field className="gl-dialog-field gl-percent-field" name="tint" value={`${trimNumber(percent, 1)} %`} onCommit={(t) => { const v = parsePercent(t); if (v === null) return false; setPercent(Math.min(100, Math.max(0, v))); }} onEnter={enter} />
        </div>
      )}
      {locked && <p className="gl-form-note">Built-in swatches cannot be edited.</p>}
      <p className="gl-form-error" data-testid="dialog-error" role="alert">
        {error}
      </p>
    </Modal>
  );
}
