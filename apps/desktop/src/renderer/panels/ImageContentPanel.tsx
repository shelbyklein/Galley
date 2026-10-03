import { setFrameProps, type ImageContent } from '@galley/model';
import { useState } from 'react';
import { selectDoc, useEditorStore } from '../store';
import { applyFit, fittableFrames, type FitMode } from '../tools/place';
import { Field } from '../shell/control-strip/Field';
import { displayUnit, formatLength, parseLength } from '../shell/control-strip/units';
import { Panel } from './Panel';

/** Image-local points: edits never change the enclosing frame or its rotation. */
export function editContent(content: ImageContent, axis: keyof ImageContent, value: number, linked: boolean): ImageContent | null {
  if (!Number.isFinite(value) || ((axis === 'w' || axis === 'h') && value <= 0)) return null;
  const next = { ...content, [axis]: value };
  if (linked && axis === 'w') next.h = content.h * value / content.w;
  if (linked && axis === 'h') next.w = content.w * value / content.h;
  return Object.values(next).every(Number.isFinite) && next.w > 0 && next.h > 0 ? next : null;
}

export function ImageContentPanel() {
  const doc = useEditorStore(selectDoc);
  const selection = useEditorStore((s) => s.selection);
  const frames = fittableFrames(doc, selection);
  const frame = frames.length === 1 ? frames[0] : undefined;
  const [linked, setLinked] = useState(true);
  const unit = displayUnit();
  const commit = (axis: keyof ImageContent, text: string) => {
    const value = parseLength(text, unit);
    if (!frame?.content || value === null) return false;
    const content = editContent(frame.content, axis, value, linked);
    if (!content) return false;
    useEditorStore.getState().dispatch(setFrameProps, { ids: [frame.id], props: { content } });
    return true;
  };
  return <Panel id="imageContent">
    {frame ? <div className="gl-image-controls" key={frame.id}>
      <p className="gl-panel-note">Content relative to frame</p>
      <div className="gl-image-grid">
        {(['x', 'y', 'w', 'h'] as const).map((axis) => <Field key={axis} name={`content-${axis}`} label={`${axis.toUpperCase()}:`} value={formatLength(frame.content![axis], unit)} title={`${axis.toUpperCase()} of image content`} onCommit={(text) => commit(axis, text)} />)}
      </div>
      <label className="gl-image-proportions"><input type="checkbox" checked={linked} onChange={(e) => setLinked(e.target.checked)} data-testid="content-proportions" />Constrain content proportions</label>
      <select className="gl-input" value="" aria-label="Image content fitting" onChange={(e) => e.target.value && applyFit(useEditorStore, e.target.value as FitMode)}>
        <option value="">Fitting…</option>
        <option value="fillProportionally">Fill Frame Proportionally</option>
        <option value="fitProportionally">Fit Content Proportionally</option>
        <option value="contentToFrame">Fit Content to Frame</option>
        <option value="center">Center Content</option>
      </select>
    </div> : <p className="gl-panel-note">Select one placed image to adjust its content.</p>}
  </Panel>;
}
