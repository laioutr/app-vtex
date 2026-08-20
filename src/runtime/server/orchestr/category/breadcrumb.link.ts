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
});
