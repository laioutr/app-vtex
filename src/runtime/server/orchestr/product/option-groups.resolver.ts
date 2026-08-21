import { ProductOptionGroups } from '@laioutr-core/canonical-types/entity/product';
import { defineVtexComponentResolver } from '../../middleware/defineVtex';
import { loadProducts } from '../../vtex-helper/loadProducts';
import { toProductOptionGroups } from '../../vtex-helper/mappers/product';

export default defineVtexComponentResolver({
  label: 'VTEX Product Option Groups Connector',
  entityType: 'Product',
  // Separate because a product VTEX declares no axes for should carry no component at all: an
  // empty group list would tell the storefront there is a selector to render when there is not.
  provides: [ProductOptionGroups],
  resolve: async ({ entityIds, context, passthrough, $entity }) => {
    const products = await loadProducts(context.vtexClient, passthrough, entityIds);

    const entities = entityIds.flatMap((id) => {
      const product = products.find((p) => p.productId === id);
      if (!product) return [];

      const optionGroups = toProductOptionGroups(product);
      if (optionGroups.groups.length === 0) return [];

      return [$entity({ id, optionGroups: () => optionGroups })];
    });

    return { entities };
  },
  cache: {
    // The runner's client-env prefix carries no market, so two markets sharing a language and
    // currency would otherwise share entries despite resolving different sales channels.
    getKeySuffix: (clientEnv) => clientEnv.market.slug,
    // The axes change with the catalog, but availability on each value moves with stock.
    ttl: '1 minute',
  },
});
