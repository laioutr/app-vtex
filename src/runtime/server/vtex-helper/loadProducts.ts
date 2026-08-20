import { searchByIds } from './searchByIds';
import type { VtexClient } from '../client/types';
import type { VtexProduct } from './mappers/product';
import type { ComponentResolverArguments } from '@laioutr-core/orchestr/types';
import { loadedProductsToken } from '../const/passthroughTokens';

/** The store type is reachable only through the handler arguments that carry it. */
type PassthroughStore = ComponentResolverArguments['passthrough'];

/**
 * Adds products a query or link already fetched to the request's store, so the resolvers that run
 * afterwards read them instead of asking VTEX for documents it just sent.
 */
export const seedProducts = (passthrough: PassthroughStore, products: VtexProduct[]) => {
  if (products.length === 0) return;

  const known = passthrough.get(loadedProductsToken) ?? [];
  const fresh = products.filter((p) => !known.some((k) => k.productId === p.productId));

  if (fresh.length > 0) passthrough.set(loadedProductsToken, [...known, ...fresh]);
};

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

  // `fq=skuId:` does not filter; productId is the one that does.
  const fetched = await searchByIds(client, 'productId', missing);

  const all = [...known, ...fetched];
  passthrough.set(loadedProductsToken, all);

  return all;
};
