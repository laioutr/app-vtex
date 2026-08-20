import { ProductVariantsLink } from '@laioutr-core/canonical-types/ecommerce';
import { defineVtexLink } from '../../middleware/defineVtex';
import { loadProducts } from '../../vtex-helper/loadProducts';

export default defineVtexLink({
  implements: ProductVariantsLink,
  run: async ({ entityIds, context, passthrough }) => {
    if (entityIds.length === 0) return { links: [] };

    // A VTEX SKU is a canonical ProductVariant, and the search response already nests them.
    const products = await loadProducts(context.vtexClient, passthrough, entityIds);

    return {
      links: entityIds.map((sourceId) => {
        const items = products.find((p) => p.productId === sourceId)?.items ?? [];

        return { sourceId, targetIds: items.map((item) => item.itemId), entityTotal: items.length };
      }),
    };
  },
  cache: {
    strategy: 'ttl',
    ttl: '10 minutes',
    // The runner already prefixes a client-env key, so market, locale and currency are covered.
    buildCacheKey: ({ entityIds }) => [...entityIds].sort().join(','),
  },
});
