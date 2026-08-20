import { BreadcrumbItemBase } from '@laioutr-core/canonical-types/entity/breadcrumb-item';
import { defineVtexComponentResolver } from '../../middleware/defineVtex';
import { categoryIdFromBreadcrumbId } from '../../vtex-helper/breadcrumbItems';
import { findById, loadCategoryTree, slugFromUrl } from '../../vtex-helper/categoryTree';

export default defineVtexComponentResolver({
  label: 'VTEX Breadcrumb Connector',
  entityType: 'BreadcrumbItem',
  provides: [BreadcrumbItemBase],
  resolve: async ({ entityIds, context, $entity }) => {
    const categoryIds = entityIds
      .map((id) => ({ id, categoryId: categoryIdFromBreadcrumbId(id) }))
      .filter((e): e is { id: string; categoryId: number } => e.categoryId !== undefined);

    // Ids from another breadcrumb source resolve nothing here, so the tree stays unfetched.
    if (categoryIds.length === 0) return { entities: [] };

    const tree = await loadCategoryTree(context.vtexClient);

    const entities = categoryIds.flatMap(({ id, categoryId }) => {
      const node = findById(tree, categoryId);
      if (!node) return [];

      return [
        $entity({
          id,
          base: () => ({
            name: node.name,
            // A reference rather than an href: the page type owns how a category URL is built.
            link: {
              type: 'reference' as const,
              reference: {
                type: 'Category' as const,
                slug: slugFromUrl(node.url),
                id: String(node.id),
              },
            },
          }),
        }),
      ];
    });

    return { entities };
  },
});
