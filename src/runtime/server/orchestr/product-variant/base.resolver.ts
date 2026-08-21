import {
  ProductVariantBase,
  ProductVariantInfo,
  ProductVariantOptions,
  ProductVariantQuantityPrices,
  ProductVariantQuantityRule,
  ProductVariantShipping,
} from '@laioutr-core/canonical-types/entity/product-variant';
import { defineVtexComponentResolver } from '../../middleware/defineVtex';
import { loadVariants } from '../../vtex-helper/loadVariants';
import {
  toVariantBase,
  toVariantInfo,
  toVariantOptions,
  toVariantQuantityPrices,
  toVariantQuantityRule,
  toVariantShipping,
} from '../../vtex-helper/mappers/productVariant';

export default defineVtexComponentResolver({
  label: 'VTEX Product Variant Connector',
  entityType: 'ProductVariant',
  // `prices` requires a price a SKU with no seller cannot supply, and `availability` changes far
  // faster than any of these, so both resolve separately.
  provides: [
    ProductVariantBase,
    ProductVariantInfo,
    ProductVariantOptions,
    ProductVariantQuantityPrices,
    ProductVariantQuantityRule,
    ProductVariantShipping,
  ],
  resolve: async ({ entityIds, context, passthrough, $entity }) => {
    const variants = await loadVariants(context.vtexClient, passthrough, entityIds);

    const entities = entityIds.flatMap((id) => {
      const hit = variants.get(id);
      if (!hit) return [];

      // Each thunk maps its own slice, and Orchestr calls only the ones it was asked for.
      return [
        $entity({
          id,
          base: () => toVariantBase(hit.item),
          info: () => toVariantInfo(hit.item),
          options: () => toVariantOptions(hit.item),
          quantityPrices: () => toVariantQuantityPrices(),
          quantityRule: () => toVariantQuantityRule(hit.item),
          shipping: () => toVariantShipping(),
        }),
      ];
    });

    return { entities };
  },
  cache: {
    // The runner's client-env prefix carries no market, so two markets sharing a language and
    // currency would otherwise share entries despite resolving different sales channels.
    getKeySuffix: (clientEnv) => clientEnv.market.slug,
    // Catalog copy and media change on an editorial rhythm, not a transactional one.
    ttl: '10 minutes',
  },
});
