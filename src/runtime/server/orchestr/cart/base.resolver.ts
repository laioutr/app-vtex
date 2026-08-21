import { useRuntimeConfig } from '#imports';
import { CartBase } from '@laioutr-core/canonical-types/entity/cart';
import { name } from '../../../../../package.json';
import { orderFormToken } from '../../const/passthroughTokens';
import { defineVtexComponentResolver } from '../../middleware/defineVtex';
import { checkoutUrlFor } from '../../vtex-helper/checkoutUrl';
import { toCartBase } from '../../vtex-helper/mappers/cart';

export default defineVtexComponentResolver({
  label: 'VTEX Cart Connector',
  entityType: 'Cart',
  // `cost` resolves separately because its money is required and VTEX can price a cart in a
  // currency we cannot express — which must cost the shopper their totals, not their items.
  provides: [CartBase],
  resolve: async ({ passthrough, $entity }) => {
    const orderForm = passthrough.get(orderFormToken);
    if (!orderForm) return { entities: [] };

    const config = useRuntimeConfig()[name] as { accountName: string; environment: string };
    const checkoutUrl = checkoutUrlFor(
      config.accountName,
      config.environment,
      orderForm.orderFormId
    );

    return {
      entities: [
        $entity({ id: orderForm.orderFormId, base: () => toCartBase(orderForm, checkoutUrl) }),
      ],
    };
  },
  // No cache block, here or on any other cart handler: a cart belongs to one shopper and changes on
  // every mutation, so a shared entry would hand someone another person's cart.
});
