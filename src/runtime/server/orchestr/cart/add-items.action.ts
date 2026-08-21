import { getCookie, setManagedCookie } from '#imports';
import { CartAddItemsAction } from '@laioutr-core/canonical-types/ecommerce';
import type { VtexOrderForm, VtexOrderItemAdd } from '../../types/vtexCheckout';
import type { CartBatchResultItem } from '../../vtex-helper/orderForm';
import { CHECKOUT_ORDER_FORM } from '../../client/cookies';
import { defineVtexAction } from '../../middleware/defineVtex';
import { defaultSellerIdOf } from '../../vtex-helper/mappers/product';
import {
  clearMessagesOrForget,
  createOrderForm,
  parseOrderFormId,
  toBatchResults,
  toOrderFormCookieValue,
} from '../../vtex-helper/orderForm';
import { searchByIds } from '../../vtex-helper/searchByIds';

/**
 * VTEX keeps an orderForm well beyond a browsing session, and the cookie cannot govern that either
 * way: outliving the cart costs one 404 that mints a replacement, and expiring early costs a cart
 * the shopper still had. Six months matches what VTEX stamps on its own.
 */
const ORDER_FORM_COOKIE_MAX_AGE = 60 * 60 * 24 * 180;

export default defineVtexAction(CartAddItemsAction, async ({ input, context, event }) => {
  const { vtexClient, vtexSalesChannel } = context;

  const productRows = input.filter((row) => row.type === 'product');
  const unsupported: CartBatchResultItem[] = input
    .filter((row) => row.type !== 'product')
    .map((row) => ({
      status: 'rejected',
      sku: row.type === 'sku' ? row.sku : undefined,
      reason: 'not-supported',
    }));

  if (productRows.length === 0) return { items: unsupported };

  const existingId = parseOrderFormId(getCookie(event, CHECKOUT_ORDER_FORM));
  const existing = existingId ? await clearMessagesOrForget(vtexClient, existingId) : undefined;
  const before = existing ?? (await createOrderForm(vtexClient));

  // Minting a cart is the only moment this app has a cookie worth keeping, and an action is the
  // only handler that can keep one — Orchestr streams a query's response before its handler runs.
  // VTEX's own `Set-Cookie` is ignored: it carries VTEX's domain, which the browser rejects here.
  if (!existing) {
    setManagedCookie(event, CHECKOUT_ORDER_FORM, toOrderFormCookieValue(before.orderFormId), {
      httpOnly: true,
      path: '/',
      // Not 'strict': the shopper returns from VTEX's checkout domain on a top-level GET, which
      // 'strict' would strip the cart cookie from.
      sameSite: 'lax',
      maxAge: ORDER_FORM_COOKIE_MAX_AGE,
    });
  }

  // One search for every row: VTEX refuses an add with no seller, and the canonical input has no
  // field for one. A wholesale failure here throws rather than falling back, because every
  // available fallback decides which offer the shopper is charged for.
  const products = await searchByIds(
    vtexClient,
    'skuId',
    productRows.map((row) => row.variantId)
  );
  const sellerBySku = new Map(
    products.flatMap((product) =>
      product.items.map((item) => [item.itemId, defaultSellerIdOf(item)] as const)
    )
  );

  const orderItems: VtexOrderItemAdd[] = [];
  const unorderable: CartBatchResultItem[] = [];

  for (const row of productRows) {
    const seller = sellerBySku.get(row.variantId);
    if (!seller) {
      unorderable.push({
        status: 'rejected',
        productId: row.productId,
        variantId: row.variantId,
        reason: sellerBySku.has(row.variantId) ? 'not-orderable' : 'not-found',
      });
      continue;
    }

    orderItems.push({ id: row.variantId, quantity: row.quantity, seller });
  }

  if (orderItems.length === 0) return { items: [...unsupported, ...unorderable] };

  const after = await vtexClient.publicFetch<VtexOrderForm>(
    'checkout',
    `/api/checkout/pub/orderForm/${encodeURIComponent(before.orderFormId)}/items?sc=${vtexSalesChannel}`,
    { method: 'POST', body: JSON.stringify({ orderItems }) }
  );

  const requested = productRows
    .filter((row) => sellerBySku.get(row.variantId))
    .map((row) => ({ productId: row.productId, variantId: row.variantId }));

  // The updated cart reaches the storefront through the next cart query: an action has no
  // passthrough store to hand it back through.
  return { items: [...unsupported, ...unorderable, ...toBatchResults(requested, before, after)] };
});
