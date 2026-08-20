import { createPassthroughToken } from '#imports';
import type { VtexProduct } from '../vtex-helper/mappers/product';

/**
 * Products already fetched during this request. Several resolvers read the same products for
 * different components; without a shared store each would issue its own search.
 */
export const loadedProductsToken = createPassthroughToken<VtexProduct[]>(
  '@laioutr/app-vtex/loadedProducts'
);
