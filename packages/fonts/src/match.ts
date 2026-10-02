import type { FontFaceInfo, FontFamilyInfo, FontRequest } from './types';
const priority = { document: 0, bundled: 1, system: 2 };
/** Shared matching policy for the main process and pre-export UI warnings. */
export function findFontFace(families: readonly FontFamilyInfo[], request: FontRequest): FontFaceInfo | undefined {
  const family = families.find((f) => f.family.toLowerCase() === request.family.toLowerCase());
  const matches = family?.faces.filter((face) => face.style === request.style && (face.weight === request.weight || (face.axes.wght && request.weight >= face.axes.wght.min && request.weight <= face.axes.wght.max)));
  return matches?.sort((a, b) => priority[a.source] - priority[b.source] || Number(a.weight !== request.weight) - Number(b.weight !== request.weight) || Number(!!a.axes.wght) - Number(!!b.axes.wght) || Math.abs(a.weight - request.weight) - Math.abs(b.weight - request.weight))[0];
}
