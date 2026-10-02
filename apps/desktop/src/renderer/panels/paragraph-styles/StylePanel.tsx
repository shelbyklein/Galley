import { useTypeStore } from '../../shell/control-strip/type/typeStore';
import { addStyle, basedOnProblem, BASIC_PARAGRAPH_ID, CHARACTER_PROPS, clearTextOverrides, NONE_CHARACTER_ID, PARAGRAPH_PROPS, removeStyle, resolveCharacterStyle, resolveParagraphStyle, setStyle, type CharacterStyle, type ParagraphStyle, type StyleKind } from '@galley/model';
import { useEffect, useState } from 'react';
import { useEditorStore } from '../../store';
import { PropertyControls, type TypeLayers } from '../../shell/control-strip/type/PropertyControls';
import { applyTextStyle, clearOverrides, textContext } from '../../shell/control-strip/type/targets';
import { Panel } from '../Panel';
import './styles.css';

type AnyStyle = ParagraphStyle | CharacterStyle;
function save(kind: StyleKind, style: AnyStyle, fresh: boolean): void {
  const s = useEditorStore.getState();
  if (kind === 'paragraph') s.dispatch(fresh ? addStyle : setStyle, { kind, style: style as ParagraphStyle });
  else s.dispatch(fresh ? addStyle : setStyle, { kind, style: style as CharacterStyle });
}
export function StylePanel({ kind }: { kind: StyleKind }) {
  const state = useEditorStore((s) => s);
  const doc = state.history.doc;
  const caret = useTypeStore((s) => s.caret);
  const context = textContext(state, caret);
  const table = kind === 'paragraph' ? doc.paragraphStyles : doc.characterStyles;
  const order = kind === 'paragraph' ? doc.paragraphStyleOrder : doc.characterStyleOrder;
  const activeId = kind === 'paragraph' ? context?.attrs.style : context?.characterStyle;
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => setPicked(null), [state.selection, state.textSelection]);
  const [editing, setEditing] = useState<{ style: AnyStyle; fresh: boolean } | null>(null);
  const [error, setError] = useState('');
  const id = picked && table[picked] ? picked : activeId ?? order[0]!;
  const style = table[id]!;
  const panel = kind === 'paragraph' ? 'paragraphStyles' : 'characterStyles';
  const builtin = id === (kind === 'paragraph' ? BASIC_PARAGRAPH_ID : NONE_CHARACTER_ID);
  const canEdit = kind === 'paragraph' || id !== NONE_CHARACTER_ID;
  const attempt = (action: () => void) => { try { action(); setError(''); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } };
  const newStyle = () => {
    setError('');
    setEditing({ fresh: true, style: { id: crypto.randomUUID(), name: '', basedOn: id, shared: {}, print: {}, web: {} } });
  };
  const redefine = () => {
    if (!context || !canEdit) return;
    const resolved = context.run;
    const props = kind === 'paragraph' ? PARAGRAPH_PROPS : CHARACTER_PROPS;
    const shared = Object.fromEntries(props.shared.map((k) => [k, resolved[k as keyof typeof resolved]]));
    const print = Object.fromEntries(props.print.map((k) => [k, resolved[k as keyof typeof resolved]]));
    attempt(() => {
      state.beginTransaction('Redefine Style');
      try {
        save(kind, { ...style, shared, print } as AnyStyle, false);
        for (const t of context.targets) useEditorStore.getState().dispatch(clearTextOverrides, { ...t, scope: kind === 'paragraph' ? 'all' : 'character' });
        useEditorStore.getState().commitTransaction();
      } catch (e) { useEditorStore.getState().cancelTransaction(); throw e; }
    });
  };
  return <Panel id={panel} menu={[
    { label: 'New Style', onSelect: newStyle },
    { label: 'Edit Style', disabled: !canEdit, onSelect: () => setEditing({ style: structuredClone(style), fresh: false }) },
    { label: 'Redefine Style', disabled: !context || !canEdit, onSelect: redefine },
    { label: 'Clear Overrides', disabled: !context?.overridden, onSelect: () => clearOverrides(kind === 'paragraph' ? 'all' : 'character') },
  ]}>
    <div className="gl-style-panel">
      <div role="listbox" aria-label={`${kind === 'paragraph' ? 'Paragraph' : 'Character'} styles`} className="gl-style-list">
        {order.map((sid) => { const st = table[sid]!; return <button key={sid} role="option" aria-selected={activeId === sid} data-style-id={sid} className={`gl-style-row${id === sid ? ' is-picked' : ''}`} onClick={() => { setPicked(sid); if (context) attempt(() => applyTextStyle(kind, sid)); }} onDoubleClick={() => { if (kind === 'character' && sid === NONE_CHARACTER_ID) return; setEditing({ style: structuredClone(st), fresh: false }); }}>
          <span>{st.name}{activeId === sid && context?.overridden && <span className="gl-style-override" data-testid={`${panel}-override`}> +</span>}</span>
          {st.basedOn && <small>based on {table[st.basedOn]?.name}</small>}
        </button>; })}
      </div>
      <div className="gl-style-actions">
        <button onClick={newStyle} aria-label={`New ${kind} style`}>New</button>
        <button disabled={!canEdit} onClick={() => setEditing({ style: structuredClone(style), fresh: false })}>Edit</button>
        <button disabled={!context || !canEdit} onClick={redefine}>Redefine</button>
        <button disabled={!context?.overridden} onClick={() => clearOverrides(kind === 'paragraph' ? 'all' : 'character')}>Clear Overrides</button>
        <button disabled={builtin} aria-label={`Delete ${kind} style`} onClick={() => attempt(() => { state.dispatch(removeStyle, { kind, id }); setPicked(null); })}>Delete</button>
      </div>
      {error && <p role="alert" className="gl-style-error">{error}</p>}
      {editing ? <StyleEditor key={editing.style.id} kind={kind} initial={editing.style} fresh={editing.fresh} onCancel={() => setEditing(null)} onSave={(next) => attempt(() => { save(kind, next, editing.fresh); setPicked(next.id); setEditing(null); })} /> : <StyleLayers style={style} />}
    </div>
  </Panel>;
}
function StyleLayers({ style }: { style: AnyStyle }) {
  const doc = useEditorStore((s) => s.history.doc);
  const shared = style.shared, print = style.print, web = style.web;
  const inheritance = style.basedOn ? `Inherited from ${doc.paragraphStyles[style.basedOn]?.name ?? doc.characterStyles[style.basedOn]?.name ?? 'base style'}` : 'Inherited from defaults';
  const sharedLines: string[] = [];
  const face = [shared.fontFamily, shared.fontWeight === undefined ? '' : shared.fontWeight === 400 ? 'Regular' : shared.fontWeight === 700 ? 'Bold' : `Weight ${shared.fontWeight}`, shared.fontStyle === 'italic' ? 'Italic' : ''].filter(Boolean).join(' ');
  if (face || shared.fill || shared.tracking !== undefined) sharedLines.push([face, shared.fill ? `${doc.swatches[shared.fill.swatchId]?.name ?? 'Missing swatch'}${shared.fill.tint !== 100 ? ` ${shared.fill.tint}%` : ''}${shared.fill.overprint ? ' · Overprint' : ''}` : '', shared.tracking !== undefined ? `Tracking ${shared.tracking}` : ''].filter(Boolean).join(' · '));
  const cases = { normal: 'Normal case', allCaps: 'All caps', smallCaps: 'Small caps' };
  const featureNames: Record<string, string> = { liga: 'Ligatures', smcp: 'Small caps', onum: 'Oldstyle figures', frac: 'Fractions' };
  const features = Object.entries(shared.features ?? {}).map(([tag, on]) => `${featureNames[tag] ?? (tag.startsWith('ss') ? `Stylistic set ${Number(tag.slice(2))}` : tag)} ${on ? 'on' : 'off'}`);
  const other = [shared.kerning ? `Kerning ${shared.kerning === 'metrics' ? 'Metrics' : 'None'}` : '', shared.textCase ? cases[shared.textCase] : '', shared.language ? `Language ${shared.language}` : '', 'role' in shared && shared.role ? `Role: ${shared.role}` : '', ...features].filter(Boolean);
  if (other.length) sharedLines.push(other.join(' · '));
  const printLines: string[] = [];
  if (print.fontSize !== undefined || print.leading !== undefined) printLines.push(`${print.fontSize ?? 'Inherited'} / ${print.leading ?? 'Inherited'} pt`);
  const para = style as ParagraphStyle;
  const p = para.print;
  const layout = [p.align ? p.align[0]!.toUpperCase() + p.align.slice(1) : '', ...[['firstLineIndent', 'First indent'], ['leftIndent', 'Left indent'], ['rightIndent', 'Right indent'], ['spaceBefore', 'Space before'], ['spaceAfter', 'Space after']].filter(([key]) => (p as Record<string, unknown>)[key!] !== undefined).map(([key, label]) => `${label} ${(p as Record<string, unknown>)[key!]} pt`)];
  if (layout.filter(Boolean).length) printLines.push(layout.filter(Boolean).join(' · '));
  if (p.hyphenate !== undefined) printLines.push(`Hyphenation ${p.hyphenate ? 'on' : 'off'}${p.hyphenMinWord != null || p.hyphenMinBefore != null || p.hyphenMinAfter != null ? ` · Limits ${p.hyphenMinWord ?? 'Auto'} / ${p.hyphenMinBefore ?? 'Auto'} / ${p.hyphenMinAfter ?? 'Auto'}` : ''}`);
  if (p.alignToBaselineGrid !== undefined || p.dropCapLines !== undefined) printLines.push([p.alignToBaselineGrid !== undefined ? `Baseline grid ${p.alignToBaselineGrid ? 'on' : 'off'}` : '', p.dropCapLines !== undefined ? (p.dropCapLines ? `Drop cap ${p.dropCapLines} lines, ${p.dropCapChars ?? 1} characters` : 'No drop cap') : ''].filter(Boolean).join(' · '));
  if ('baselineShift' in print) printLines.push(`Baseline shift ${print.baselineShift} pt`);
  const webLines = [web.fontSize || web.lineHeight ? `${web.fontSize ?? 'Inherited'} / ${web.lineHeight ?? 'Inherited'}` : '', web.tag ? `<${web.tag}>` : '', ...Object.entries(web.breakpoints ?? {}).map(([name, values]) => `${name}: ${values.fontSize ?? 'Inherited'} / ${values.lineHeight ?? 'Inherited'}`)].filter(Boolean);
  return <div className="gl-style-layers" data-testid="style-layers"><strong>{style.name}: style layers</strong>{([['Shared', sharedLines], ['Print', printLines], ['Web · read-only', webLines]] as const).map(([title, lines]) => <section key={title} className={`gl-style-layer${title.startsWith('Web') ? ' gl-style-layer-web' : ''}`}><strong>{title}</strong>{title.startsWith('Web') && <p>Stored, edited in Phase 6</p>}{lines.length ? lines.map((line) => <p key={line}>{line}</p>) : <p>{inheritance}</p>}</section>)}</div>;
}
function StyleEditor({ kind, initial, fresh, onSave, onCancel }: { kind: StyleKind; initial: AnyStyle; fresh: boolean; onSave(s: AnyStyle): void; onCancel(): void }) {
  const doc = useEditorStore((s) => s.history.doc);
  const table = kind === 'paragraph' ? doc.paragraphStyles : doc.characterStyles;
  const [draft, setDraft] = useState(initial);
  const [layer, setLayer] = useState<'shared' | 'print' | 'web'>('shared');
  const tables = kind === 'paragraph' ? { ...doc, paragraphStyles: { ...doc.paragraphStyles, [draft.id]: draft as ParagraphStyle } } : { ...doc, characterStyles: { ...doc.characterStyles, [draft.id]: draft as CharacterStyle } };
  const resolved = kind === 'paragraph' ? resolveParagraphStyle(tables, draft.id) : resolveCharacterStyle(tables, resolveParagraphStyle(doc, BASIC_PARAGRAPH_ID), draft.id);
  const change = (layers: TypeLayers) => setDraft((s) => ({ ...s, shared: { ...s.shared, ...layers.shared, ...(layers.shared?.features ? { features: { ...s.shared.features, ...layers.shared.features } } : {}) }, print: { ...s.print, ...layers.print } } as AnyStyle));
  const builtin = draft.id === BASIC_PARAGRAPH_ID || draft.id === NONE_CHARACTER_ID;
  return <div className="gl-style-editor" data-testid={`${kind}-style-editor`}>
    <strong>{fresh ? 'New' : 'Edit'} {kind} style</strong>
    <label>Name<input type="text" aria-label="Style name" data-testid="style-name" value={draft.name} disabled={builtin} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
    <label>Based on<select aria-label="Based on" data-testid="style-based-on" value={draft.basedOn ?? ''} disabled={builtin} onChange={(e) => setDraft({ ...draft, basedOn: e.target.value || null })}><option value="">No style</option>{Object.values(table).filter((s) => s.id !== draft.id && !basedOnProblem(table as Record<string, AnyStyle>, { ...draft, basedOn: s.id }, 'style')).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
    <div className="gl-style-layer-tabs" role="tablist" aria-label="Style layers">{(['shared', 'print', 'web'] as const).map((l) => <button key={l} role="tab" aria-selected={layer === l} onClick={() => setLayer(l)}>{l[0]!.toUpperCase() + l.slice(1)}{l === 'web' ? ' (read-only)' : ''}</button>)}</div>
    {layer === 'web' ? <div className="gl-style-web"><p>Stored, edited in Phase 6</p><p>{draft.web.fontSize ?? 'Inherited size'} / {draft.web.lineHeight ?? 'Inherited line height'}{draft.web.tag ? ` · <${draft.web.tag}>` : ''}</p></div> : <>
      <div className="gl-style-property-controls"><PropertyControls kind="character" paragraphStyle={kind === 'paragraph'} layer={layer} value={resolved} onChange={change} />{kind === 'paragraph' && <PropertyControls kind="paragraph" layer={layer} value={resolved} onChange={change} />}</div>
      {kind === 'paragraph' && layer === 'shared' && <label>Role<select aria-label="Semantic role" value={(draft as ParagraphStyle).shared.role ?? ''} onChange={(e) => change({ shared: { role: (e.target.value || null) as ParagraphStyle['shared']['role'] } })}>{['', 'body', 'heading', 'subhead', 'caption', 'quote'].map((r) => <option key={r} value={r}>{r || 'None'}</option>)}</select></label>}
      <div className="gl-style-defined">{Object.keys(draft[layer]).map((key) => <button key={key} title={`Inherit ${key} from base style`} onClick={() => setDraft((s) => { const props = { ...s[layer] }; delete (props as Record<string, unknown>)[key]; return { ...s, [layer]: props }; })}>{key} ×</button>)}</div>
    </>}
    <div className="gl-style-save"><button onClick={onCancel}>Cancel</button><button disabled={!draft.name.trim()} onClick={() => onSave(draft)}>Save Style</button></div>
  </div>;
}
export function ParagraphStylesPanel() { return <StylePanel kind="paragraph" />; }
