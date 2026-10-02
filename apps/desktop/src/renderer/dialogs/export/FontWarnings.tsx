import { findFontFace } from '@galley/fonts/match';
import { usedFontFaces } from '@galley/render';
import { parseFontRequest } from '@galley/render/fonts';
import { selectDoc, useEditorStore } from '../../store';
import { useFontFamilies } from '../../fonts';
/** Visible before export: name the CFF faces and embedding restrictions, rather than a generic post-export note. */
export function FontWarnings() {
  const doc = useEditorStore(selectDoc);
  const families = useFontFamilies();
  const names = new Set<string>();
  for (const r of doc.pageOrder.flatMap((page) => usedFontFaces(doc, page)).map(parseFontRequest)) {
    const face = findFontFace(families, r);
    if (!face) names.add(`${r.family} ${r.weight} ${r.style} is missing; substituted with Inter.`);
    else if (!face.embeddable) names.add(`${r.family} ${face.styleName}: ${face.embeddingReason}. Export requires a replacement font.`);
    else if (face.outlines === 'cff') names.add(`${r.family} ${face.styleName} exports as Type 3 (CFF outlines). Check your print shop's requirements.`);
  }
  if (!names.size || !families.length) return null;
  return <ul className="gl-export-warnings" data-testid="export-font-warnings">{[...names].map((name) => <li key={name}>{name}</li>)}</ul>;
}
