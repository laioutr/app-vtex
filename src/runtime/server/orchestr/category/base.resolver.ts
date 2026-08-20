import { CategoryBase, CategorySeo } from '@laioutr-core/canonical-types/entity/category';
import { defineVtexComponentResolver } from '../../middleware/defineVtex';
import { findById, loadCategoryTree } from '../../vtex-helper/categoryTree';
import { toCategoryComponents } from '../../vtex-helper/mappers/category';

export default defineVtexComponentResolver({
  label: 'VTEX Category Connector',
  entityType: 'Category',
  // The category tree carries no description, so `content` stays with whichever app has one.
  provides: [CategoryBase, CategorySeo],
  resolve: async ({ entityIds, context, $entity }) => {
    const tree = await loadCategoryTree(context.vtexClient);

    const entities = entityIds.flatMap((id) => {
      const node = findById(tree, Number(id));
      if (!node) return [];

      const { base, seo } = toCategoryComponents(node);
      return [$entity({ id, base: () => base, seo: () => seo })];
    });

    return { entities };
  },
  cache: {
    // Matches the category tree's own lifetime, so a cached component cannot outlive the tree it
    // was derived from.
    ttl: '10 minutes',
  },
});
