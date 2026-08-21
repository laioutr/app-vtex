import { getCookie, useRuntimeConfig } from '#imports';
import { GetCheckoutUrlAction } from '@laioutr-core/canonical-types/ecommerce';
import { name } from '../../../../../package.json';
import { CHECKOUT_ORDER_FORM } from '../../client/cookies';
import { defineVtexAction } from '../../middleware/defineVtex';
import { checkoutUrlFor } from '../../vtex-helper/checkoutUrl';
import { parseOrderFormId } from '../../vtex-helper/orderForm';

export default defineVtexAction(GetCheckoutUrlAction, async ({ event }) => {
  const config = useRuntimeConfig()[name] as { accountName: string; environment: string };

  return {
    checkoutUrl: checkoutUrlFor(
      config.accountName,
      config.environment,
      parseOrderFormId(getCookie(event, CHECKOUT_ORDER_FORM))
    ),
  };
});
