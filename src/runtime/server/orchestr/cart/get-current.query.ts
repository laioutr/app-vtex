import { deleteManagedCookie, getCookie } from '#imports';
import { GetCurrentCartQuery } from '@laioutr-core/canonical-types/ecommerce';
import { CHECKOUT_ORDER_FORM } from '../../client/cookies';
import { orderFormToken } from '../../const/passthroughTokens';
import { defineVtexQuery } from '../../middleware/defineVtex';
import { parseOrderFormId, readOrderForm } from '../../vtex-helper/orderForm';

export default defineVtexQuery(GetCurrentCartQuery, async ({ context, event, passthrough }) => {
  const orderFormId = parseOrderFormId(getCookie(event, CHECKOUT_ORDER_FORM));

  // VTEX has no read-only orderForm call, so resolving one here would mint a cart and set a cookie
  // on every visitor who ever renders a cart badge, bots included.
  if (!orderFormId) return { id: undefined };

  const orderForm = await readOrderForm(context.vtexClient, orderFormId);
  if (!orderForm) {
    deleteManagedCookie(event, CHECKOUT_ORDER_FORM, { path: '/' });
    return { id: undefined };
  }

  passthrough.set(orderFormToken, orderForm);

  return { id: orderForm.orderFormId };
});
