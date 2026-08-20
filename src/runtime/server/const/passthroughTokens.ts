import { createPassthroughToken } from '#imports';
import type { VtexProduct } from '../vtex-helper/mappers/product';

/**
 * Products already fetched during this request. Several resolvers read the same products for
 * different components; without a shared store each would issue its own search.
 */
export const loadedProductsToken = createPassthroughToken<VtexProduct[]>(
  '@laioutr/app-vtex/loadedProducts'
);

/**
 * The category ids making up the menu currently being resolved. A menu is a subtree, so an item's
 * parent in the full category tree is not necessarily part of the menu — without this the items
 * at the top of a subtree menu would each report a parent the frontend never received, leaving it
 * unable to tell which items start the menu.
 */
export const menuItemIdsToken = createPassthroughToken<string[]>('@laioutr/app-vtex/menuItemIds');
