import { CategoryBreadcrumbLink } from '@laioutr-core/canonical-types/ecommerce';
import { defineVtexLink } from '../../middleware/defineVtex';
import { toCategoryBreadcrumbId } from '../../vtex-helper/breadcrumbItems';
import { ancestorsOf, loadCategoryTree } from '../../vtex-helper/categoryTree';

export default defineVtexLink({
  implements: CategoryBreadcrumbLink,
  run: async ({ entityIds, context }) => {
    if (entityIds.length === 0) return { links: [] };

    const tree = await loadCategoryTree(context.vtexClient);

    return {
      links: entityIds.map((sourceId) => {
        // The trail ends on the category itself, so the current page is part of the breadcrumb.
        const trail = [...ancestorsOf(tree, Number(sourceId)).map((n) => n.id), Number(sourceId)];

        return { sourceId, targetIds: trail.map(toCategoryBreadcrumbId) };
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
