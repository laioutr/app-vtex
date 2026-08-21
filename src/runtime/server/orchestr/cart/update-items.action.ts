import { getCookie } from '#imports';
import { CartUpdateItemsAction } from '@laioutr-core/canonical-types/ecommerce';
import { CHECKOUT_ORDER_FORM } from '../../client/cookies';
import { defineVtexAction } from '../../middleware/defineVtex';
import {
  clearMessagesAndRead,
  indexByUniqueId,
  parseOrderFormId,
  toOrderItemUpdates,
} from '../../vtex-helper/orderForm';

export default defineVtexAction(CartUpdateItemsAction, async ({ input, context, event }) => {
  const orderFormId = parseOrderFormId(getCookie(event, CHECKOUT_ORDER_FORM));
  if (!orderFormId) throw new Error('Cannot update a cart the shopper does not have');

  // Clearing first is what makes the messages on the response belong to this call; the snapshot it
  // returns is also the only thing that can turn a uniqueId into the index VTEX demands.
  const snapshot = await clearMessagesAndRead(context.vtexClient, orderFormId);
  const orderItems = toOrderItemUpdates(input, indexByUniqueId(snapshot));
  if (orderItems.length === 0) return;

  // `customFields` are dropped: VTEX has no per-line equivalent, and the token defines unsupported
  // features as ignored rather than as failures.
  await context.vtexClient.publicFetch(
    'checkout',
    `/api/checkout/pub/orderForm/${encodeURIComponent(orderFormId)}/items/update?sc=${context.vtexSalesChannel}`,
    { method: 'POST', body: JSON.stringify({ orderItems }) }
  );
});
