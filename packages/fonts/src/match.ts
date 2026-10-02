import type { FontFaceInfo, FontFamilyInfo, FontRequest } from './types';
const priority = { document: 0, bundled: 1, system: 2 };
/** Shared matching policy for the main process and pre-export UI warnings. */
export function findFontFace(families: readonly FontFamilyInfo[], request: FontRequest): FontFaceInfo | undefined {
  const family = families.find((f) => f.family.toLowerCase() === request.family.toLowerCase());
  const matches = family?.faces.filter((face) => face.style === request.style && (face.weight === request.weight || (face.axes.wght && request.weight >= face.axes.wght.min && request.weight <= face.axes.wght.max)));
  const exact = matches?.sort((a, b) => priority[a.source] - priority[b.source] || Number(a.weight !== request.weight) - Number(b.weight !== request.weight) || Number(!!a.axes.wght) - Number(!!b.axes.wght) || Math.abs(a.weight - request.weight) - Math.abs(b.weight - request.weight))[0];
  if (exact) return exact;
  // Preserve the original bundled CSS's nearest-weight behavior (notably 800/900 italic → 700 italic).
  // Installed and document families require an exact face or a supported variable axis.
  const bundled = family?.faces.filter(face => face.source === 'bundled' && face.style === request.style);
  const order = (weight: number) => {
    if (request.weight < 400) return weight <= request.weight ? request.weight - weight : 1000 + weight - request.weight;
    if (request.weight > 500) return weight >= request.weight ? weight - request.weight : 1000 + request.weight - weight;
    if (weight >= request.weight && weight <= 500) return weight - request.weight;
    return weight < request.weight ? 1000 + request.weight - weight : 2000 + weight - 500;
  };
  return bundled?.sort((a, b) => order(a.weight) - order(b.weight))[0];
}
