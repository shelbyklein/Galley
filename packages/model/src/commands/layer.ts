import type { Id } from '../ids';
import { parentOf } from '../queries';
import { layerSchema, type Layer } from '../schema';
import { defineCommand, fail } from './types';
import { baseOf, deleteFrameTrees, insertAt, layerOf, own, removeFrom } from './util';

/** Add a layer. `index` is the position in the bottom-to-top order; default the top. */
export const addLayer = defineCommand<{ layer: Layer; index?: number }>('layer.add', 'New Layer', (d, { layer, index }) => {
  const r = layerSchema.safeParse(layer);
  if (!r.success) fail(`Invalid layer: ${r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  if (d.layers[layer.id]) fail(`Layer "${layer.id}" already exists`);
  insertAt(d.layerOrder, layer.id, index);
  d.layers[layer.id] = own(layer);
});

/** Delete a layer and the frames on it. The last layer cannot be deleted. */
export const removeLayer = defineCommand<{ id: Id }>('layer.remove', 'Delete Layer', (d, { id }) => {
  layerOf(d, id);
  if (d.layerOrder.length <= 1) fail('A document needs at least one layer');
  const base = baseOf(d);
  const doomed = Object.values(base.frames)
    .filter((f) => f.layerId === id && parentOf(base, f.id) === null)
    .map((f) => f.id);
  if (doomed.length > 0) deleteFrameTrees(d, doomed);
  removeFrom(d.layerOrder, id);
  delete d.layers[id];
});

export type LayerProps = Partial<Pick<Layer, 'name' | 'color' | 'visible' | 'locked'>>;

/** Rename, recolor, hide/show or lock/unlock a layer. */
export const setLayerProps = defineCommand<{ id: Id; props: LayerProps }>('layer.setProps', 'Change Layer', (d, { id, props }) => {
  const layer = layerOf(d, id);
  const r = layerSchema.pick({ name: true, color: true, visible: true, locked: true }).partial().safeParse(props);
  if (!r.success) fail(`Invalid layer properties: ${r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  Object.assign(layer, r.data);
});

/** Reorder a layer in the bottom-to-top order. */
export const moveLayer = defineCommand<{ id: Id; index: number }>('layer.move', 'Move Layer', (d, { id, index }) => {
  layerOf(d, id);
  if (!Number.isInteger(index) || index < 0 || index >= d.layerOrder.length) fail(`Index ${index} is out of range`);
  removeFrom(d.layerOrder, id);
  d.layerOrder.splice(index, 0, id);
});
