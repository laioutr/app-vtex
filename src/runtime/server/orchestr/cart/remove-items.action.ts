import { getCookie } from '#imports';
import { CartRemoveItemsAction } from '@laioutr-core/canonical-types/ecommerce';
import { CHECKOUT_ORDER_FORM } from '../../client/cookies';
import { defineVtexAction } from '../../middleware/defineVtex';
import {
  clearMessagesAndRead,
  indexByUniqueId,
  parseOrderFormId,
  toOrderItemUpdates,
} from '../../vtex-helper/orderForm';

export default defineVtexAction(CartRemoveItemsAction, async ({ input, context, event }) => {
  const orderFormId = parseOrderFormId(getCookie(event, CHECKOUT_ORDER_FORM));
  if (!orderFormId) throw new Error('Cannot remove from a cart the shopper does not have');

  const snapshot = await clearMessagesAndRead(context.vtexClient, orderFormId);
  const orderItems = toOrderItemUpdates(
    input.map((itemId) => ({ itemId, quantity: 0 })),
    indexByUniqueId(snapshot)
  );
  if (orderItems.length === 0) return;

  // Every index goes in one payload: VTEX applies them against the positions this snapshot has, so
  // issuing them one at a time would delete by indices the earlier removals had already shifted.
  await context.vtexClient.publicFetch(
    'checkout',
    `/api/checkout/pub/orderForm/${encodeURIComponent(orderFormId)}/items/update?sc=${context.vtexSalesChannel}`,
    { method: 'POST', body: JSON.stringify({ orderItems }) }
  );
});
