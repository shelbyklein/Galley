import type { HistoryState } from '@galley/model';

/** Assets reachable by undo/redo must travel with Save As before a scratch package is removed. */
export function historyAssetPaths(history: HistoryState): string[] {
  const paths = new Set(Object.values(history.doc.assets).map((a) => a.path));
  const add = (value: unknown) => {
    if (value && typeof value === 'object' && 'path' in value && typeof value.path === 'string') paths.add(value.path);
  };
  for (const entry of [...history.past, ...history.future, ...(history.pending ? [history.pending] : [])]) {
    for (const patch of [...entry.patches, ...entry.inversePatches]) {
      if (patch.path[0] !== 'assets' || !('value' in patch)) continue;
      if (patch.path.length === 3 && patch.path[2] === 'path' && typeof patch.value === 'string') paths.add(patch.value);
      else if (patch.path.length === 2) add(patch.value);
      else if (patch.path.length === 1 && patch.value && typeof patch.value === 'object') Object.values(patch.value).forEach(add);
    }
  }
  return [...paths];
}
