import type { Id } from '../ids';
import { assetLinkSchema, assetSchema, assetIntrinsicSchema, type Asset } from '../schema';
import { defineCommand, fail } from './types';
import { assetOf, own } from './util';

/** Register a linked image. Placing it in a frame is a separate step (`frame.setProps` with `assetId` and `content`). */
export const addAsset = defineCommand<{ asset: Asset }>('asset.add', 'Place Image', (d, { asset }) => {
  const r = assetSchema.safeParse(asset);
  if (!r.success) fail(`Invalid asset: ${r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  if (d.assets[asset.id]) fail(`Asset "${asset.id}" already exists`);
  d.assets[asset.id] = own(asset);
});

export type AssetProps = Partial<Omit<Asset, 'id' | 'kind'>>;

/** Relink or refresh an asset: new path, hash, pixel size, ppi or color space. */
export const setAssetProps = defineCommand<{ id: Id; props: AssetProps }>('asset.setProps', 'Relink Image', (d, { id, props }) => {
  const asset = assetOf(d, id);
  const r = assetIntrinsicSchema.omit({ id: true, kind: true }).partial().extend(assetLinkSchema.partial().shape).safeParse(props);
  if (!r.success) fail(`Invalid asset properties: ${r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  Object.assign(asset, r.data);
});

/** Remove an asset. Image frames that used it become empty graphic frames. */
export const removeAsset = defineCommand<{ id: Id }>('asset.remove', 'Remove Image', (d, { id }) => {
  assetOf(d, id);
  for (const f of Object.values(d.frames)) {
    if (f.type === 'image' && f.assetId === id) {
      f.assetId = null;
      f.content = null;
    }
  }
  delete d.assets[id];
});
