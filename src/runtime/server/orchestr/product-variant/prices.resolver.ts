import { ProductVariantPrices } from '@laioutr-core/canonical-types/entity/product-variant';
import { defineVtexComponentResolver } from '../../middleware/defineVtex';
import { loadVariants } from '../../vtex-helper/loadVariants';
import { toVariantPrices } from '../../vtex-helper/mappers/productVariant';

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

      const prices = toVariantPrices(hit.item, currency);
      // No seller means no price, and the component's price is required.
      if (!prices) return [];

      return [$entity({ id, prices: () => prices })];
    });

    return { entities };
  },
  cache: {
    // The runner's client-env prefix carries no market, so two markets sharing a language and
    // currency would otherwise share entries despite resolving different sales channels.
    getKeySuffix: (clientEnv) => clientEnv.market.slug,
    // Shorter than the catalog components: a price the shopper is quoted should not lag far behind
    // the one checkout will charge.
    ttl: '5 minutes',
  },
});
