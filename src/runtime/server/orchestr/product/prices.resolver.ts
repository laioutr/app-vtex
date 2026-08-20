import { ProductPrices } from '@laioutr-core/canonical-types/entity/product';
import { defineVtexComponentResolver } from '../../middleware/defineVtex';
import { loadProducts } from '../../vtex-helper/loadProducts';
import { toProductComponents } from '../../vtex-helper/mappers/product';

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

      const { prices } = toProductComponents(product, currency);
      // A product with no seller has no price, and the component's price is required.
      if (!prices) return [];

      return [$entity({ id, prices: () => prices })];
    });

    return { entities };
  },
});
