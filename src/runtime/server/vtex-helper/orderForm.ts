import type { VtexClient } from '../client/types';
import type { VtexOrderForm, VtexOrderItemUpdate } from '../types/vtexCheckout';
import type { CartAddItemsAction } from '@laioutr-core/canonical-types/ecommerce';
import type { ActionTokenOutputOf } from '@laioutr-core/core-types/orchestr';
import { VtexApiError } from '../client/types';

const OFID_PREFIX = '__ofid=';

/**
 * `canonical-types` ships no import path for this shape, so it is read back off the token that
 * defines it — which also means it cannot drift from what the action must return.
 */
export type CartBatchResultItem = ActionTokenOutputOf<typeof CartAddItemsAction>['items'][number];

export interface RequestedRow {
  productId: string;
  variantId: string;
}

/** VTEX wraps the id in its own key inside the cookie value rather than storing it bare. */
export const parseOrderFormId = (cookieValue: string | undefined): string | undefined => {
  if (!cookieValue?.startsWith(OFID_PREFIX)) return undefined;
  return cookieValue.slice(OFID_PREFIX.length).trim() || undefined;
};

/**
 * Mints a cart. VTEX has no read-only mode, so only an action may call this. The cart cookie needs
 * no explicit write: VTEX answers this call with a `Set-Cookie`, which the client already routes to
 * the managed-cookie writer.
 */
export const createOrderForm = (client: VtexClient): Promise<VtexOrderForm> =>
  client.publicFetch<VtexOrderForm>('checkout', '/api/checkout/pub/orderForm', {
    method: 'POST',
    body: '{}',
  });

/**
 * A 404 means the cart expired upstream, which is knowledge rather than failure — the caller clears
 * the cookie. Every other status rethrows: an empty cart shown to a shopper who has three items
 * invites them to add everything twice.
 */
export const readOrderForm = async (
  client: VtexClient,
  id: string
): Promise<VtexOrderForm | undefined> => {
  try {
    return await client.publicFetch<VtexOrderForm>(
      'checkout',
      `/api/checkout/pub/orderForm/${encodeURIComponent(id)}`
    );
  } catch (error) {
    if (error instanceof VtexApiError && error.status === 404) {
      console.warn(`[app-vtex] orderForm ${id} is gone upstream; treating the shopper as cartless`);
      return undefined;
    }
    throw error;
  }
};

/**
 * Messages persist on an orderForm until something clears them, so a mutation that read them
 * without clearing first would keep re-reporting a rejection from ten minutes ago. The response
 * carries the whole orderForm, which is also the snapshot an index map and a quantity diff need.
 */
export const clearMessagesAndRead = (client: VtexClient, id: string): Promise<VtexOrderForm> =>
  client.publicFetch<VtexOrderForm>(
    'checkout',
    `/api/checkout/pub/orderForm/${encodeURIComponent(id)}/messages/clear`,
    { method: 'POST', body: '{}' }
  );

export const indexByUniqueId = (orderForm: VtexOrderForm): Map<string, number> =>
  new Map(orderForm.items.map((line, index) => [line.uniqueId, index]));

/**
 * `items/update` addresses lines by position and nothing else, and positions shift when a line is
 * removed. A `uniqueId` the snapshot does not know is a line that is already gone, so it is dropped
 * rather than translated into whatever now sits at that position.
 */
export const toOrderItemUpdates = (
  rows: { itemId: string; quantity?: number }[],
  index: Map<string, number>
): VtexOrderItemUpdate[] =>
  rows.flatMap((row) => {
    if (row.quantity === undefined) return [];

    const position = index.get(row.itemId);
    if (position === undefined) {
      console.warn(`[app-vtex] cart line ${row.itemId} is no longer in the cart; skipping it`);
      return [];
    }

    return [{ index: position, quantity: row.quantity }];
  });

const quantityOfSku = (orderForm: VtexOrderForm, skuId: string): number =>
  orderForm.items.filter((line) => line.id === skuId).reduce((sum, line) => sum + line.quantity, 0);

/**
 * VTEX answers 200 for a row it refused and names the reason in `messages`, so a per-row failure is
 * an outcome to report rather than an error to throw — which is exactly how the token defines it.
 */
export const toBatchResults = (
  requested: RequestedRow[],
  before: VtexOrderForm,
  after: VtexOrderForm
): CartBatchResultItem[] =>
  requested.map((row) => {
    const rejectedUpstream = after.messages.some(
      (message) => message.code === 'ORD027' && message.fields?.id === row.variantId
    );
    const line = after.items.find((candidate) => candidate.id === row.variantId);

    if (rejectedUpstream || !line) {
      return {
        status: 'rejected',
        productId: row.productId,
        variantId: row.variantId,
        reason: 'not-found',
      };
    }

    if (line.availability && line.availability !== 'available') {
      return {
        status: 'rejected',
        productId: row.productId,
        variantId: row.variantId,
        reason: 'sold-out',
        reasonLabel: line.availability,
      };
    }

    // The gain, not the line total: adding to a line that already held two must not report four.
    const gained = quantityOfSku(after, row.variantId) - quantityOfSku(before, row.variantId);

    return {
      status: 'added',
      productId: row.productId,
      variantId: row.variantId,
      quantity: Math.max(gained, 0),
    };
  });
