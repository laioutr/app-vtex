import {
  CartItemAvailability,
  CartItemBase,
  CartItemCost,
  CartItemProductData,
  CartItemQuantityRule,
} from '@laioutr-core/canonical-types/entity/cart-item';
import { orderFormToken } from '../../const/passthroughTokens';
import { defineVtexComponentResolver } from '../../middleware/defineVtex';
import {
  currencyOf,
  toCartItemAvailability,
  toCartItemBase,
  toCartItemCost,
  toCartItemQuantityRule,
} from '../../vtex-helper/mappers/cart';

export default defineVtexComponentResolver({
  label: 'VTEX Cart Item Connector',
  entityType: 'CartItem',
  provides: [
    CartItemBase,
    CartItemCost,
    CartItemProductData,
    CartItemAvailability,
    CartItemQuantityRule,
  ],
  resolve: async ({ entityIds, passthrough, $entity }) => {
    const orderForm = passthrough.get(orderFormToken);
    if (!orderForm) return { entities: [] };

    const currency = currencyOf(orderForm);
    const byUniqueId = new Map(orderForm.items.map((line) => [line.uniqueId, line]));

    // Guarding per line, not around the loop: a line VTEX returns in an unusable shape costs that
    // line, never the whole cart.
    const entities = entityIds.flatMap((id) => {
      const line = byUniqueId.get(id);
      if (!line) return [];

      const cost = currency ? toCartItemCost(line, currency) : undefined;
      if (!cost) {
        console.warn(`[app-vtex] cart line ${id} has no expressible cost; dropping the line`);
        return [];
      }

      return [
        $entity({
          id,
          base: () => toCartItemBase(line),
          cost: () => cost,
          // VTEX carries a measurement unit but no base-unit price, so there is nothing to report.
          productData: () => undefined,
          availability: () => toCartItemAvailability(line),
          quantityRule: () => toCartItemQuantityRule(line),
        }),
      ];
    });

    return { entities };
  },
});
