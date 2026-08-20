import { ProductPrices } from '@laioutr-core/canonical-types/entity/product';
import { defineVtexComponentResolver } from '../../middleware/defineVtex';
import { loadProducts } from '../../vtex-helper/loadProducts';
import { toProductPrices } from '../../vtex-helper/mappers/product';

export default defineVtexComponentResolver({
  label: 'VTEX Product Prices Connector',
  entityType: 'Product',
  provides: [ProductPrices],
  resolve: async ({ entityIds, context, clientEnv, passthrough, $entity }) => {
    const products = await loadProducts(context.vtexClient, passthrough, entityIds);
    const currency = clientEnv.market.currency;

    const entities = entityIds.flatMap((id) => {
      const product = products.find((p) => p.productId === id);
      if (!product) return [];

      const prices = toProductPrices(product, currency);
      // A product with no seller has no price, and the component's price is required.
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
