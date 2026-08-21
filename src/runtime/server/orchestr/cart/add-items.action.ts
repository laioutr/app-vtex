import { getCookie } from '#imports';
import { CartAddItemsAction } from '@laioutr-core/canonical-types/ecommerce';
import type { VtexOrderForm, VtexOrderItemAdd } from '../../types/vtexCheckout';
import type { CartBatchResultItem } from '../../vtex-helper/orderForm';
import { CHECKOUT_ORDER_FORM } from '../../client/cookies';
import { defineVtexAction } from '../../middleware/defineVtex';
import { defaultSellerIdOf } from '../../vtex-helper/mappers/product';
import {
  clearMessagesAndRead,
  createOrderForm,
  parseOrderFormId,
  toBatchResults,
} from '../../vtex-helper/orderForm';
import { searchByIds } from '../../vtex-helper/searchByIds';

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

  // Creating one writes no cookie here on purpose: VTEX answers with a `Set-Cookie` and the client
  // already forwards it to the managed-cookie writer.
  const existingId = parseOrderFormId(getCookie(event, CHECKOUT_ORDER_FORM));
  const before =
    existingId ?
      await clearMessagesAndRead(vtexClient, existingId)
    : await createOrderForm(vtexClient);

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
