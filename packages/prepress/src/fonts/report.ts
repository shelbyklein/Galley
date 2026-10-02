import type { FontBinding, FontReportEntry } from '@galley/fonts/types';
export function fontReport(bindings: FontBinding[]): FontReportEntry[] {
  return bindings.map((b) => ({
    family: b.family, weight: b.weight, style: b.style, resolvedFamily: b.face.family,
    styleName: b.face.styleName, source: b.face.source, path: b.face.path, fsType: b.face.fsType,
    status: b.missing ? 'substituted' : b.face.outlines === 'cff' ? 'type3' : b.instanceAxes ? 'instanced' : 'truetype',
    warning: b.missing ? `${b.family} ${b.weight} ${b.style} is missing; substituted with ${b.face.family}.` : b.face.outlines === 'cff' ? `${b.family} ${b.face.styleName} exports as Type 3 (CFF outlines). Check your print shop's requirements.` : null,
  }));
}
