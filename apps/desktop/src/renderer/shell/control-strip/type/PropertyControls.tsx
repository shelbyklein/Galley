import { BASIC_PARAGRAPH_PROPS, type CharacterOverrides, type ParagraphOverrides, type ResolvedParagraph } from '@galley/model';
import { useFontFamilies } from '../../../fonts';
import { useEditorStore } from '../../../store';
import { Field } from '../Field';

export type TypeLayers = ParagraphOverrides & CharacterOverrides;
export interface ControlsProps { kind: 'character' | 'paragraph'; value?: ResolvedParagraph | null; onChange(layers: TypeLayers): void; disabled?: boolean; layer?: 'shared' | 'print'; paragraphStyle?: boolean; }
const FEATURES = [['liga', 'Ligatures'], ['smcp', 'Small caps'], ['onum', 'Oldstyle figures'], ['frac', 'Fractions']] as const;
export function PropertyControls({ kind, value, onChange, disabled = false, layer, paragraphStyle = false }: ControlsProps) {
  const r = value ?? BASIC_PARAGRAPH_PROPS;
  const fonts = useFontFamilies();
  const doc = useEditorStore((s) => s.history.doc);
  const family = fonts.find((f) => f.family === r.fontFamily);
  const faces = family?.faces ?? [];
  const face = faces.find((f) => f.weight === r.fontWeight && f.style === r.fontStyle);
  const select = (name: string, label: string, current: string, options: { value: string; label: string }[], change: (v: string) => void, width = 90) => <label className="gl-type-select" title={label}><span>{label}</span><select aria-label={label} data-type-control={name} value={current} disabled={disabled} style={{ width, ...(name === 'fontStyle' ? { fontFamily: r.fontFamily, fontWeight: r.fontWeight, fontStyle: r.fontStyle } : {}) }} onChange={(e) => change(e.target.value)}>{options.map((o) => <option key={o.value} value={o.value} style={name === 'fontFamily' ? { fontFamily: o.value } : name === 'fontStyle' ? { fontFamily: r.fontFamily, fontWeight: Number(o.value.split(':')[0]), fontStyle: o.value.split(':')[1] as 'normal' | 'italic' } : undefined}>{o.label}</option>)}</select></label>;
  const number = (name: string, label: string, v: number | null, target: 'shared' | 'print' = 'print', min?: number, max?: number, integer = false) => <Field key={name} name={name} label={label} title={label} value={v === null ? 'Auto' : String(v)} disabled={disabled} width={112} onCommit={(text) => {
    const n = text.trim().toLowerCase() === 'auto' && ['hyphenMinWord', 'hyphenMinBefore', 'hyphenMinAfter', 'hyphenLadder'].includes(name) ? null : Number(text.replace(/\s*pt\s*$/i, ''));
    if (n !== null && (!text.trim() || !Number.isFinite(n) || (min !== undefined && n < min) || (max !== undefined && n > max) || (integer && !Number.isInteger(n)))) return false;
    onChange({ [target]: { [name]: n } }); return true;
  }} />;
  const check = (name: string, label: string, checked: boolean, change: (v: boolean) => void) => <label className="gl-type-check" title={label}><input aria-label={label} data-type-control={name} type="checkbox" checked={checked} disabled={disabled} onChange={(e) => change(e.target.checked)} />{label}</label>;
  if (kind === 'paragraph') return <>
    {layer !== 'shared' && <>
      <div className="gl-type-group">{select('align', 'Alignment', r.align, ['left', 'center', 'right', 'justify'].map((value) => ({ value, label: value[0]!.toUpperCase() + value.slice(1) })), (align) => onChange({ print: { align: align as ResolvedParagraph['align'] } }))}{check('hyphenate', 'Hyphenate', r.hyphenate, (hyphenate) => onChange({ print: { hyphenate } }))}</div>
      <div className="gl-type-group">{number('firstLineIndent', 'First line', r.firstLineIndent)}{number('leftIndent', 'Left indent', r.leftIndent, 'print', 0)}</div>
      <div className="gl-type-group">{number('rightIndent', 'Right indent', r.rightIndent, 'print', 0)}{number('spaceBefore', 'Before', r.spaceBefore, 'print', 0)}</div>
      <div className="gl-type-group">{number('spaceAfter', 'After', r.spaceAfter, 'print', 0)}{check('alignToBaselineGrid', 'Baseline grid', r.alignToBaselineGrid, (alignToBaselineGrid) => onChange({ print: { alignToBaselineGrid } }))}</div>
      <div className="gl-type-group">{number('hyphenMinWord', 'Min. word', r.hyphenMinWord, 'print', 1, 50, true)}{number('hyphenMinBefore', 'Before break', r.hyphenMinBefore, 'print', 1, 50, true)}</div>
      <div className="gl-type-group">{number('hyphenMinAfter', 'After break', r.hyphenMinAfter, 'print', 1, 50, true)}<label className="gl-type-check" title="Consecutive hyphenated line limits are unavailable.">Hyphen lines <input aria-label="Hyphen lines" value={r.hyphenLadder ?? 'Unlimited'} disabled style={{ width:60 }} /><span>Unavailable</span></label></div>
      <div className="gl-type-group">{number('dropCapLines', 'Drop lines', r.dropCapLines, 'print', 0, 25, true)}{number('dropCapChars', 'Drop chars', r.dropCapChars, 'print', 1, 25, true)}</div>
    </>}
  </>;
  return <>
    {layer !== 'print' && <>
      <div className="gl-type-group gl-type-font">{select('fontFamily', 'Font family', r.fontFamily, [...(!family ? [{ value: r.fontFamily, label: `${r.fontFamily} (missing)` }] : []), ...fonts.map((f) => ({ value: f.family, label: f.family }))], (fontFamily) => { const nextFaces = fonts.find((x) => x.family === fontFamily)?.faces ?? []; const f = nextFaces.find((x) => x.weight === r.fontWeight && x.style === r.fontStyle) ?? nextFaces.find((x) => x.weight === 400 && x.style === 'normal') ?? [...nextFaces].sort((a, b) => (a.style === r.fontStyle ? 0 : 1000) + Math.abs(a.weight - r.fontWeight) - ((b.style === r.fontStyle ? 0 : 1000) + Math.abs(b.weight - r.fontWeight)))[0]; onChange({ shared: { fontFamily, ...(f ? { fontWeight: f.weight, fontStyle: f.style } : {}) } }); }, 155)}{select('fontStyle', 'Font style', face ? `${face.weight}:${face.style}` : `${r.fontWeight}:${r.fontStyle}`, [...(!face ? [{ value: `${r.fontWeight}:${r.fontStyle}`, label: `${r.fontWeight} ${r.fontStyle} (missing)` }] : []), ...faces.map((f) => ({ value: `${f.weight}:${f.style}`, label: f.styleName }))], (v) => { const [weight, style] = v.split(':'); onChange({ shared: { fontWeight: Number(weight), fontStyle: style as 'normal' | 'italic' } }); }, 155)}</div>
    </>}
    {layer !== 'shared' && <div className="gl-type-group">{number('fontSize', 'Size', r.fontSize, 'print', 0.01)}{number('leading', 'Leading', r.leading, 'print', 0.01)}</div>}
    {layer !== 'print' && <>
      <div className="gl-type-group">{number('tracking', 'Tracking', r.tracking, 'shared')}{select('kerning', 'Kerning', r.kerning, [{ value: 'metrics', label: 'Metrics' }, { value: 'none', label: 'None' }], (kerning) => onChange({ shared: { kerning: kerning as 'metrics' | 'none' } }), 72)}</div>
      <div className="gl-type-group">{select('textCase', 'Case', r.textCase, [{ value: 'normal', label: 'Normal' }, { value: 'allCaps', label: 'All caps' }, { value: 'smallCaps', label: 'Small caps' }], (textCase) => onChange({ shared: { textCase: textCase as ResolvedParagraph['textCase'] } }))}{select('language', 'Language', r.language, [...new Set([r.language, 'en-US', 'en-GB', 'fr', 'de', 'es'])].map((value) => ({ value, label: value })), (language) => onChange({ shared: { language } }))}</div>
    </>}
    {layer !== 'shared' && !paragraphStyle && <div className="gl-type-group">{number('baselineShift', 'Baseline', r.baselineShift)}{select('baselinePreset', 'Position', 'normal', [{ value: 'normal', label: 'Normal' }, { value: 'super', label: 'Superscript' }, { value: 'sub', label: 'Subscript' }], (v) => onChange({ print: { baselineShift: v === 'super' ? r.fontSize * 0.33 : v === 'sub' ? -r.fontSize * 0.2 : 0 } }))}</div>}
    {layer !== 'print' && <>
      <div className="gl-type-group">{select('fill', 'Text color', r.fill.swatchId, doc.swatchOrder.map((id) => ({ value: id, label: doc.swatches[id]!.name })), (swatchId) => onChange({ shared: { fill: { ...r.fill, swatchId } } }))}<div className="gl-type-check">Tint<input aria-label="Text tint" data-type-control="tint" type="number" min={0} max={100} value={r.fill.tint} disabled={disabled} style={{ width:50 }} onChange={(e) => { const tint = Number(e.target.value); if (tint >= 0 && tint <= 100) onChange({ shared: { fill: { ...r.fill, tint } } }); }} />{check('overprint', 'Overprint', r.fill.overprint, (overprint) => onChange({ shared: { fill: { ...r.fill, overprint } } }))}</div></div>
      <div className="gl-type-group gl-type-features">{FEATURES.map(([tag, label]) => check(tag, label, r.features[tag] ?? tag === 'liga', (v) => onChange({ shared: { features: { [tag]: v } } })))}</div>
      <div className="gl-type-group">{select('stylisticSet', 'Stylistic set', '', [{ value: '', label: 'Choose…' }, ...Array.from({ length: 20 }, (_, i) => ({ value: `ss${String(i + 1).padStart(2, '0')}`, label: `Set ${i + 1}${r.features[`ss${String(i + 1).padStart(2, '0')}`] ? ' ✓' : ''}` }))], (tag) => tag && onChange({ shared: { features: { [tag]: !r.features[tag] } } }))}<span className="gl-type-feature-note">{Object.entries(r.features).filter(([tag, on]) => tag.startsWith('ss') && on).map(([tag]) => tag).join(', ') || 'No stylistic sets'}</span></div>
    </>}
  </>;
}
