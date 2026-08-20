import type { VtexClient } from '../client/types';
import type { VtexProduct } from './mappers/product';
import type { ComponentResolverArguments } from '@laioutr-core/orchestr/types';
import { loadedProductsToken } from '../const/passthroughTokens';

/** The store type is reachable only through the handler arguments that carry it. */
type PassthroughStore = ComponentResolverArguments['passthrough'];

/**
 * Fetches only the products not already in the request's store and folds the result back in, so
 * the base, info and prices resolvers of one request share a single search.
 */
export const loadProducts = async (
  client: VtexClient,
  passthrough: PassthroughStore,
  ids: string[]
): Promise<VtexProduct[]> => {
  const known = passthrough.get(loadedProductsToken) ?? [];
  const missing = ids.filter((id) => !known.some((p) => p.productId === id));

  if (missing.length === 0) return known;

  const params = new URLSearchParams([
    // `fq=skuId:` does not filter; productId is the one that does.
    ...missing.map((id) => ['fq', `productId:${id}`] as [string, string]),
    ['sc', client.salesChannel],
    ['_from', '0'],
    ['_to', String(Math.max(missing.length - 1, 0))],
  ]);

  const fetched = await client.publicFetch<VtexProduct[]>(
    'catalogSystem',
    `/api/catalog_system/pub/products/search?${params}`
  );

  const all = [...known, ...fetched];
  passthrough.set(loadedProductsToken, all);

  return all;
};
