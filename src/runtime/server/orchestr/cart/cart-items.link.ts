import { CartItemsLink } from '@laioutr-core/canonical-types/ecommerce';
import { orderFormToken } from '../../const/passthroughTokens';
import { defineVtexLink } from '../../middleware/defineVtex';

export default defineVtexLink({
  implements: CartItemsLink,
  run: async ({ passthrough }) => {
    const orderForm = passthrough.get(orderFormToken);
    if (!orderForm) return { links: [] };

    return {
      links: [
        {
          sourceId: orderForm.orderFormId,
          targetIds: orderForm.items.map((line) => line.uniqueId),
          entityTotal: orderForm.items.length,
        },
      ],
    };
  },
  // No cache block, here or on either resolver: a cart belongs to one shopper and changes on every
  // mutation, so a shared entry would hand someone another person's cart.
});
