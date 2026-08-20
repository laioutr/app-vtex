import { searchByIds } from './searchByIds';
import type { VtexClient } from '../client/types';
import type { VtexItem, VtexProduct } from './mappers/product';
import type { ComponentResolverArguments } from '@laioutr-core/orchestr/types';
import { loadedProductsToken } from '../const/passthroughTokens';

type PassthroughStore = ComponentResolverArguments['passthrough'];

/**
 * A SKU is addressable only through its product, so this searches by SKU id and reads the matching
 * item back out. One search returns the whole parent product, which also fills the store for any
 * sibling SKU the same request asks about.
 */
export const loadVariants = async (
  client: VtexClient,
  passthrough: PassthroughStore,
  skuIds: string[]
): Promise<Map<string, { item: VtexItem; product: VtexProduct }>> => {
  const known = passthrough.get(loadedProductsToken) ?? [];
  const index = (products: VtexProduct[]) =>
    new Map(
      products.flatMap((product) =>
        product.items.map((item) => [item.itemId, { item, product }] as const)
      )
    );

  const found = index(known);
  const missing = skuIds.filter((id) => !found.has(id));
  if (missing.length === 0) return found;

  const fetched = await searchByIds(client, 'skuId', missing);

  const all = [...known, ...fetched.filter((p) => !known.some((k) => k.productId === p.productId))];
  passthrough.set(loadedProductsToken, all);

  return index(all);
};
