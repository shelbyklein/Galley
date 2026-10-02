import { useEditorStore } from '../../../store';
import { PropertyControls } from './PropertyControls';
import { applyTextStyle, clearOverrides, overrideText, textContext } from './targets';
import { useTypeStore } from './typeStore';
import './type.css';
export function TypeControlStrip() {
  const state = useEditorStore((s) => s);
  const caret = useTypeStore((s) => s.caret);
  const context = textContext(state, caret);
  const mode = useTypeStore((s) => s.mode);
  const setMode = useTypeStore((s) => s.setMode);
  const doc = state.history.doc;
  return <div className="gl-type-strip" data-testid="type-control-strip" data-mode={mode}>
    <div className="gl-type-toggle" role="group" aria-label="Type control mode">
      <button aria-label="Character controls" aria-pressed={mode === 'character'} onClick={() => setMode('character')}>A</button>
      <button aria-label="Paragraph controls" aria-pressed={mode === 'paragraph'} onClick={() => setMode('paragraph')}>¶</button>
    </div>
    <div className="gl-type-scroll"><PropertyControls kind={mode} value={mode === 'character' ? context?.run : context?.paragraph} disabled={!context} onChange={(set) => overrideText(mode, set)} /></div>
    <div className="gl-type-group gl-type-style-select"><label>Paragraph style<select aria-label="Paragraph style" data-type-control="paragraphStyle" value={context?.attrs.style ?? ''} disabled={!context} onChange={(e) => applyTextStyle('paragraph', e.target.value)}>{!context && <option value="">No text selected</option>}{doc.paragraphStyleOrder.map((id) => <option key={id} value={id}>{doc.paragraphStyles[id]!.name}{context?.attrs.style === id && context.overridden ? ' +' : ''}</option>)}</select></label><button className="gl-type-clear" disabled={!context?.overridden} onClick={() => clearOverrides()}>Clear Overrides</button></div>
  </div>;
}
