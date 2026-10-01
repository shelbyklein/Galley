import { selectDoc, selectIsDirty, useEditorStore } from '../store';

/** Window title bar content (lane C): the document title and a dirty mark. The native traffic lights float over its left edge. */
export function TitleBar() {
  const title = useEditorStore((s) => selectDoc(s).meta.title);
  const dirty = useEditorStore(selectIsDirty);
  return (
    <span data-testid="doc-title">
      {title}
      {dirty ? ' — Edited' : ''}
    </span>
  );
}
