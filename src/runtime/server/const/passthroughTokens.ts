import { createPassthroughToken } from '#imports';
import type { VtexOrderForm } from '../types/vtexCheckout';
import type { VtexProduct } from '../vtex-helper/mappers/product';

/**
 * Products already fetched during this request. Several resolvers read the same products for
 * different components; without a shared store each would issue its own search.
 */
export const loadedProductsToken = createPassthroughToken<VtexProduct[]>(
  '@laioutr/app-vtex/loadedProducts'
);

/**
 * The cart read during this request. The query, both resolvers and both links need the same
 * orderForm, and VTEX charges a round trip for each one that fetches it again.
 */
export const orderFormToken = createPassthroughToken<VtexOrderForm>('@laioutr/app-vtex/orderForm');
