export * from './types';
export { addAsset, removeAsset, setAssetProps, type AssetProps } from './asset';
export { setBaselineGrid, setMeta } from './doc';
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
export { transformFrames, type FrameGeometry } from './transform';
export { addLayer, moveLayer, removeLayer, setLayerProps, type LayerProps } from './layer';
export { addPage, movePage, removePage, setPageProps, type PageProps } from './page';
export { applyCharacterStyle, applyParagraphStyle, clearTextOverrides, setStoryDoc, setTextOverrides, type TextOverrideTarget } from './story';
export { addStyle, moveStyle, removeStyle, setStyle, type StyleArgs } from './style';
export { insertFrameInThread, linkFrames, removeFrameFromThread, unlinkFrame } from './thread';
export { addSwatch, removeSwatch, setSwatchProps, type SwatchProps } from './swatch';

import { addAsset, removeAsset, setAssetProps } from './asset';
import { setBaselineGrid, setMeta } from './doc';
import { addFrame, groupFrames, moveFrames, moveFramesToLayer, moveFramesToPage, removeFrames, reorderFrames, setFrameProps, ungroupFrames } from './frame';
import { addGuide, moveGuide, removeGuide } from './guide';
import { transformFrames } from './transform';
import { addLayer, moveLayer, removeLayer, setLayerProps } from './layer';
import { addPage, movePage, removePage, setPageProps } from './page';
import { applyCharacterStyle, applyParagraphStyle, clearTextOverrides, setStoryDoc, setTextOverrides } from './story';
import { addStyle, moveStyle, removeStyle, setStyle } from './style';
import { insertFrameInThread, linkFrames, removeFrameFromThread, unlinkFrame } from './thread';
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
  setBaselineGrid,
  addFrame,
  groupFrames,
  moveFrames,
  moveFramesToLayer,
  moveFramesToPage,
  removeFrames,
  reorderFrames,
  setFrameProps,
  transformFrames,
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
  applyCharacterStyle,
  applyParagraphStyle,
  clearTextOverrides,
  setStoryDoc,
  setTextOverrides,
  addStyle,
  moveStyle,
  removeStyle,
  setStyle,
  insertFrameInThread,
  linkFrames,
  removeFrameFromThread,
  unlinkFrame,
  addSwatch,
  removeSwatch,
  setSwatchProps,
} satisfies Record<string, CommandDef<never>>;
