import { CartCost } from '@laioutr-core/canonical-types/entity/cart';
import { orderFormToken } from '../../const/passthroughTokens';
import { defineVtexComponentResolver } from '../../middleware/defineVtex';
import { currencyOf, toCartCost } from '../../vtex-helper/mappers/cart';

export default defineVtexComponentResolver({
  label: 'VTEX Cart Cost Connector',
  entityType: 'Cart',
  provides: [CartCost],
  resolve: async ({ passthrough, $entity }) => {
    const orderForm = passthrough.get(orderFormToken);
    if (!orderForm) return { entities: [] };

    const currency = currencyOf(orderForm);
    const cost = currency ? toCartCost(orderForm, currency) : undefined;

    // Resolving no cost keeps the shopper's items on screen when the money is unreadable, which
    // dropping the whole cart would not.
    if (!cost) {
      console.warn(
        `[app-vtex] cart ${orderForm.orderFormId} has no expressible money; serving it without costs`
      );
      return { entities: [] };
    }

    return { entities: [$entity({ id: orderForm.orderFormId, cost: () => cost })] };
  },
});
