import { selectDoc, selectIsDirty, useEditorStore } from '../store';

/**
 * Window title bar content: `Spring Poster.galley @ 50%`, plus an Edited mark while there are unsaved changes. The
 * native traffic lights float over its left edge. The title is the document's `meta.title` (a first Save As adopts the
 * file name when the title is still "Untitled").
 */
export function TitleBar() {
  const title = useEditorStore((s) => selectDoc(s).meta.title);
  const dirty = useEditorStore(selectIsDirty);
  const zoom = useEditorStore((s) => s.viewport.zoom);
  return (
    <span className="gl-title" data-dirty={dirty}>
      <span data-testid="doc-title">{title}</span>
      <span className="gl-title-suffix">.galley @ {Math.round(zoom * 100)}%</span>
      {dirty && (
        <span className="gl-title-edited" data-testid="dirty-mark">
          {' — Edited'}
        </span>
      )}
    </span>
  );
}
