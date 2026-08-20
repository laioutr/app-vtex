import {
  ProductVariantAvailability,
  ProductVariantBase,
  ProductVariantInfo,
  ProductVariantOptions,
} from '@laioutr-core/canonical-types/entity/product-variant';
import { defineVtexComponentResolver } from '../../middleware/defineVtex';
import { loadVariants } from '../../vtex-helper/loadVariants';
import { toVariantComponents } from '../../vtex-helper/mappers/productVariant';

export default defineVtexComponentResolver({
  label: 'VTEX Product Variant Connector',
  entityType: 'ProductVariant',
  // `prices` requires a price, which a SKU with no seller cannot supply, so it resolves separately.
  provides: [
    ProductVariantBase,
    ProductVariantInfo,
    ProductVariantOptions,
    ProductVariantAvailability,
  ],
  resolve: async ({ entityIds, context, clientEnv, passthrough, $entity }) => {
    const variants = await loadVariants(context.vtexClient, passthrough, entityIds);
    const currency = clientEnv.market.currency;

    const entities = entityIds.flatMap((id) => {
      const hit = variants.get(id);
      if (!hit) return [];

      const mapped = toVariantComponents(hit.item, currency);

      return [
        $entity({
          id,
          base: () => mapped.base,
          info: () => mapped.info,
          options: () => mapped.options,
          availability: () => mapped.availability,
        }),
      ];
    });

    return { entities };
  },
});
