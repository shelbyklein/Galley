import type { Insets } from '@galley/model';
import { useRef, useState } from 'react';
import { Field } from '../shell/control-strip/Field';
import { formatNumber, parseLength, type DisplayUnit } from '../shell/control-strip/units';
import { Icon } from '../shell/Icon';
import { Modal } from './Modal';
import { CUSTOM_PRESET, defaultNewDocumentSpec, PAGE_PRESETS, pageFromSpec, presetForSize, type NewDocumentSpec } from './presets';

type InsetKey = 'margins' | 'bleed' | 'slug';
const SIDES: readonly { key: keyof Insets; label: string }[] = [
  { key: 'top', label: 'Top' },
  { key: 'bottom', label: 'Bottom' },
  { key: 'left', label: 'Left' },
  { key: 'right', label: 'Right' },
];

const allEqual = (i: Insets) => i.top === i.right && i.right === i.bottom && i.bottom === i.left;

/**
 * File > New: a page-size preset (Letter, Tabloid, A4, A3, 18 x 24 in, 24 x 36 in) or a custom size, orientation,
 * margins, columns and gutter, bleed and slug. Everything is stored in points; the unit menu only changes how the
 * fields show and read lengths (a field also accepts a unit typed after the number: `0.125 in`, `3mm`).
 */
export function NewDocumentDialog({ onDone }: { onDone(spec: NewDocumentSpec | null): void }) {
  const [spec, setSpec] = useState<NewDocumentSpec>(defaultNewDocumentSpec);
  const [unit, setUnit] = useState<DisplayUnit>('in');
  const [linked, setLinked] = useState<Record<InsetKey, boolean>>({ margins: true, bleed: true, slug: true });
  const submitRef = useRef<() => void>(() => {});

  const preset = presetForSize(spec.width, spec.height);
  const presetId = preset?.id ?? CUSTOM_PRESET;
  const landscape = spec.width > spec.height;
  const made = pageFromSpec(spec);
  const fmt = (pt: number) => formatNumber(pt, unit);
  const parse = (text: string) => parseLength(text, unit);

  const choosePreset = (id: string) => {
    const p = PAGE_PRESETS.find((x) => x.id === id);
    if (!p) return;
    setSpec((s) => (landscape ? { ...s, width: p.height, height: p.width } : { ...s, width: p.width, height: p.height }));
  };
  const setOrientation = (wantLandscape: boolean) => {
    if (wantLandscape === landscape) return;
    setSpec((s) => ({ ...s, width: s.height, height: s.width }));
  };
  const setSize = (key: 'width' | 'height', text: string) => {
    const v = parse(text);
    if (v === null || v <= 0) return false;
    setSpec((s) => ({ ...s, [key]: v }));
  };
  const setInset = (group: InsetKey, side: keyof Insets, text: string) => {
    const v = parse(text);
    if (v === null || v < 0) return false;
    setSpec((s) => ({ ...s, [group]: linked[group] ? { top: v, right: v, bottom: v, left: v } : { ...s[group], [side]: v } }));
  };
  const setColumns = (text: string) => {
    const n = Math.round(Number(text));
    if (!Number.isFinite(n) || n < 1 || n > 64) return false;
    setSpec((s) => ({ ...s, columns: { ...s.columns, count: n } }));
  };
  const setGutter = (text: string) => {
    const v = parse(text);
    if (v === null || v < 0) return false;
    setSpec((s) => ({ ...s, columns: { ...s.columns, gutter: v } }));
  };
  const toggleLinked = (group: InsetKey) => {
    const next = !linked[group];
    setLinked((l) => ({ ...l, [group]: next }));
    if (next && !allEqual(spec[group])) {
      const v = spec[group].top;
      setSpec((s) => ({ ...s, [group]: { top: v, right: v, bottom: v, left: v } }));
    }
  };

  const submit = () => {
    if (made.page) onDone(spec);
  };
  submitRef.current = submit;
  const enter = () => setTimeout(() => submitRef.current(), 0);

  const insetGroup = (group: InsetKey, title: string) => (
    <fieldset className="gl-fieldset" data-group={group}>
      <legend>{title}</legend>
      <div className="gl-fields-row">
        {SIDES.map((s) => (
          <Field key={s.key} className="gl-dialog-field" name={`${group}-${s.key}`} label={s.label} value={fmt(spec[group][s.key])} onCommit={(t) => setInset(group, s.key, t)} onEnter={enter} />
        ))}
        <button type="button" className={`gl-cs-link${linked[group] ? ' is-on' : ''}`} aria-pressed={linked[group]} aria-label={`Make all ${title.toLowerCase()} the same`} title="Make all settings the same" data-testid={`${group}-link`} onClick={() => toggleLinked(group)}>
          <Icon name="chain" size={14} />
        </button>
      </div>
    </fieldset>
  );

  return (
    <Modal title="New Document" testId="new-document-dialog" okLabel="Create" okDisabled={!made.page} onOk={submit} onCancel={() => onDone(null)} width={460}>
      <div className="gl-form-row">
        <label className="gl-form-label" htmlFor="nd-preset">
          Page size
        </label>
        <select id="nd-preset" className="gl-input" data-field="preset" value={presetId} onChange={(e) => choosePreset(e.target.value)}>
          {PAGE_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
          <option value={CUSTOM_PRESET}>Custom</option>
        </select>
        <label className="gl-form-label" htmlFor="nd-unit">
          Units
        </label>
        <select id="nd-unit" className="gl-input gl-input-narrow" data-field="unit" value={unit} onChange={(e) => setUnit(e.target.value as DisplayUnit)}>
          <option value="pt">Points</option>
          <option value="in">Inches</option>
          <option value="mm">Millimeters</option>
        </select>
      </div>
      <div className="gl-fields-row">
        <Field className="gl-dialog-field" name="width" label="Width" value={fmt(spec.width)} onCommit={(t) => setSize('width', t)} onEnter={enter} />
        <Field className="gl-dialog-field" name="height" label="Height" value={fmt(spec.height)} onCommit={(t) => setSize('height', t)} onEnter={enter} />
        <div className="gl-orientation" role="radiogroup" aria-label="Orientation">
          <button type="button" role="radio" aria-checked={!landscape} className={`gl-orient${!landscape ? ' is-on' : ''}`} data-orientation="portrait" onClick={() => setOrientation(false)}>
            Portrait
          </button>
          <button type="button" role="radio" aria-checked={landscape} className={`gl-orient${landscape ? ' is-on' : ''}`} data-orientation="landscape" onClick={() => setOrientation(true)}>
            Landscape
          </button>
        </div>
      </div>
      {insetGroup('margins', 'Margins')}
      <fieldset className="gl-fieldset" data-group="columns">
        <legend>Columns</legend>
        <div className="gl-fields-row">
          <Field className="gl-dialog-field" name="columns" label="Number" value={String(spec.columns.count)} onCommit={setColumns} onEnter={enter} />
          <Field className="gl-dialog-field" name="gutter" label="Gutter" value={fmt(spec.columns.gutter)} onCommit={setGutter} onEnter={enter} />
        </div>
      </fieldset>
      {insetGroup('bleed', 'Bleed')}
      {insetGroup('slug', 'Slug')}
      <p className="gl-form-error" data-testid="dialog-error" role="alert">
        {made.error ?? ''}
      </p>
    </Modal>
  );
}
