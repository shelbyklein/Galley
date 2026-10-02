import { findFontFace } from '@galley/fonts/match';
import { usedFontFaces } from '@galley/render';
import { parseFontRequest } from '@galley/render/fonts';
import { selectDoc, useEditorStore } from '../store';
import { useFontFamilies } from './index';

export function FontStatus() {
  const doc = useEditorStore(selectDoc);
  const families = useFontFamilies();
  if (!families.length) return null;
  const missing = [...new Set(doc.pageOrder.flatMap((page) => usedFontFaces(doc, page)).map(parseFontRequest).filter((r) => !findFontFace(families, r)).map((r) => `${r.family} ${r.weight} ${r.style}`))];
  if (!missing.length) return null;
  return <details className="gl-font-status" data-testid="status-missing-fonts">
    <summary>{missing.length} missing {missing.length === 1 ? 'font' : 'fonts'}</summary>
    <div role="status"><strong>Missing fonts — substituted with Inter</strong><ul>{missing.map((name) => <li key={name}>{name}</li>)}</ul></div>
  </details>;
}
