import { ProductBreadcrumbLink } from '@laioutr-core/canonical-types/ecommerce';
import { defineVtexLink } from '../../middleware/defineVtex';
import {
  categoryIdsFromPath,
  toCategoryBreadcrumbId,
  toProductBreadcrumbId,
} from '../../vtex-helper/breadcrumbItems';
import { loadProducts } from '../../vtex-helper/loadProducts';

export default defineVtexLink({
  implements: ProductBreadcrumbLink,
  run: async ({ entityIds, context, passthrough }) => {
    if (entityIds.length === 0) return { links: [] };

    const products = await loadProducts(context.vtexClient, passthrough, entityIds);

    return {
      links: entityIds.map((sourceId) => {
        // VTEX lists the deepest category path first, which is the trail a shopper arrived along.
        const deepest = products.find((p) => p.productId === sourceId)?.categoriesIds?.[0] ?? '';

        return {
          sourceId,
          targetIds: [
            ...categoryIdsFromPath(deepest).map(toCategoryBreadcrumbId),
            toProductBreadcrumbId(sourceId),
          ],
        };
      }),
    };
  },
  cache: {
    strategy: 'ttl',
    ttl: '10 minutes',
    // The runner's client-env prefix is locale, currency and preview only — the market is absent,
    // and two markets sharing a language and currency can still resolve different sales channels.
    buildCacheKey: ({ entityIds, clientEnv }) =>
      `${clientEnv.market.slug}:${[...entityIds].sort().join(',')}`,
  },
});
