import { ChildCategoriesLink } from '@laioutr-core/canonical-types/ecommerce';
import { defineVtexLink } from '../../middleware/defineVtex';
import { findById, loadCategoryTree } from '../../vtex-helper/categoryTree';

export default defineVtexLink({
  implements: ChildCategoriesLink,
  run: async ({ entityIds, context, pagination }) => {
    if (entityIds.length === 0) return { links: [] };

    const tree = await loadCategoryTree(context.vtexClient);

    return {
      links: entityIds.map((sourceId) => {
        const children = findById(tree, Number(sourceId))?.children ?? [];

        return {
          sourceId,
          targetIds: children
            .slice(pagination.offset, pagination.offset + pagination.limit)
            .map((child) => String(child.id)),
          entityTotal: children.length,
        };
      }),
    };
  },
  cache: {
    strategy: 'ttl',
    ttl: '10 minutes',
    // The runner already prefixes a client-env key, so market, locale and currency are covered.
    buildCacheKey: ({ entityIds, pagination }) =>
      `${[...entityIds].sort().join(',')}:${pagination.offset}:${pagination.limit}`,
  },
});
