import { CartItemProductVariantLink } from '@laioutr-core/canonical-types/ecommerce';
import { orderFormToken } from '../../const/passthroughTokens';
import { defineVtexLink } from '../../middleware/defineVtex';

export default defineVtexLink({
  implements: CartItemProductVariantLink,
  run: async ({ entityIds, passthrough }) => {
    const orderForm = passthrough.get(orderFormToken);
    if (!orderForm) return { links: [] };

    const byUniqueId = new Map(orderForm.items.map((line) => [line.uniqueId, line]));

    // A VTEX SKU id is a canonical ProductVariant id, so the line already carries the target.
    return {
      links: entityIds.flatMap((sourceId) => {
        const line = byUniqueId.get(sourceId);
        return line ? [{ sourceId, targetId: line.id }] : [];
      }),
    };
  },
});
