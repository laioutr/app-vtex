import { ProductVariantPrices } from '@laioutr-core/canonical-types/entity/product-variant';
import { defineVtexComponentResolver } from '../../middleware/defineVtex';
import { loadVariants } from '../../vtex-helper/loadVariants';
import { toVariantComponents } from '../../vtex-helper/mappers/productVariant';

export default defineVtexComponentResolver({
  label: 'VTEX Product Variant Prices Connector',
  entityType: 'ProductVariant',
  provides: [ProductVariantPrices],
  resolve: async ({ entityIds, context, clientEnv, passthrough, $entity }) => {
    const variants = await loadVariants(context.vtexClient, passthrough, entityIds);
    const currency = clientEnv.market.currency;

    const entities = entityIds.flatMap((id) => {
      const hit = variants.get(id);
      if (!hit) return [];

      const { prices } = toVariantComponents(hit.item, currency);
      // No seller means no price, and the component's price is required.
      if (!prices) return [];

      return [$entity({ id, prices: () => prices })];
    });

    return { entities };
  },
});
