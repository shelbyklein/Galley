import { expect, it } from 'vitest';
import { addAsset, applyCommand, createDocument, createHistory, setAssetProps, undo } from '@galley/model';
import { historyAssetPaths } from './historyAssets';

it('retains asset-add and relink resources in both undo and redo histories for Save As', () => {
  let h = applyCommand(createHistory(createDocument({ title: 'History assets', engineVersion: 'test' })), addAsset, { asset: { id: 'image', kind: 'image', path: 'assets/old.png', hash: `sha256:${'0'.repeat(64)}`, width: 100, height: 100, ppi: 72, colorSpace: 'rgb' } });
  h = applyCommand(h, setAssetProps, { id: 'image', props: { path: 'assets/new.png' } });
  expect(new Set(historyAssetPaths(h))).toEqual(new Set(['assets/old.png', 'assets/new.png']));
  h = undo(h);
  expect(new Set(historyAssetPaths(h))).toEqual(new Set(['assets/old.png', 'assets/new.png']));
  h = undo(h);
  expect(new Set(historyAssetPaths(h))).toEqual(new Set(['assets/old.png', 'assets/new.png']));
});
