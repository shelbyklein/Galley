export * from './types';
export { addAsset, removeAsset, setAssetProps, type AssetProps } from './asset';
export { setMeta } from './doc';
export {
  addFrame,
  groupFrames,
  moveFrames,
  moveFramesToLayer,
  moveFramesToPage,
  removeFrames,
  reorderFrames,
  setFrameProps,
  ungroupFrames,
  type AddFrameArgs,
  type FrameProps,
  type ReorderOp,
} from './frame';
export { addGuide, moveGuide, removeGuide } from './guide';
export { addLayer, moveLayer, removeLayer, setLayerProps, type LayerProps } from './layer';
export { addPage, movePage, removePage, setPageProps, type PageProps } from './page';
export { setStoryDefaults, setStoryDoc } from './story';
export { addSwatch, removeSwatch, setSwatchProps, type SwatchProps } from './swatch';

import { addAsset, removeAsset, setAssetProps } from './asset';
import { setMeta } from './doc';
import { addFrame, groupFrames, moveFrames, moveFramesToLayer, moveFramesToPage, removeFrames, reorderFrames, setFrameProps, ungroupFrames } from './frame';
import { addGuide, moveGuide, removeGuide } from './guide';
import { addLayer, moveLayer, removeLayer, setLayerProps } from './layer';
import { addPage, movePage, removePage, setPageProps } from './page';
import { setStoryDefaults, setStoryDoc } from './story';
import { addSwatch, removeSwatch, setSwatchProps } from './swatch';
import type { CommandDef } from './types';

/**
 * Every command in the model, by name. Add new commands here: the random-sequence test and the app's command list
 * both iterate this object.
 */
export const allCommands = {
  addAsset,
  removeAsset,
  setAssetProps,
  setMeta,
  addFrame,
  groupFrames,
  moveFrames,
  moveFramesToLayer,
  moveFramesToPage,
  removeFrames,
  reorderFrames,
  setFrameProps,
  ungroupFrames,
  addGuide,
  moveGuide,
  removeGuide,
  addLayer,
  moveLayer,
  removeLayer,
  setLayerProps,
  addPage,
  movePage,
  removePage,
  setPageProps,
  setStoryDefaults,
  setStoryDoc,
  addSwatch,
  removeSwatch,
  setSwatchProps,
} satisfies Record<string, CommandDef<never>>;
