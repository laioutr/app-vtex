import {
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
  // `prices` requires a price a SKU with no seller cannot supply, and `availability` changes far
  // faster than any of these, so both resolve separately.
  provides: [ProductVariantBase, ProductVariantInfo, ProductVariantOptions],
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
        }),
      ];
    });

    return { entities };
  },
  cache: {
    // Catalog copy and media change on an editorial rhythm, not a transactional one.
    ttl: '10 minutes',
  },
});
