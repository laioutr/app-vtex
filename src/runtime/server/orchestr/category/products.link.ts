import { CategoryProductsLink } from '@laioutr-core/canonical-types/ecommerce';
import { defineVtexLink } from '../../middleware/defineVtex';
import { createLegacySearchProvider } from '../../search/legacy';
import { categoryPathOf, loadCategoryTree } from '../../vtex-helper/categoryTree';

export default defineVtexLink({
  implements: CategoryProductsLink,
  run: async ({ entityIds, context, pagination }) => {
    if (entityIds.length === 0) return { links: [] };

    const provider = createLegacySearchProvider(context.vtexClient);
    const tree = await loadCategoryTree(context.vtexClient);

    // One search per source: the legacy endpoint filters on a single category path.
    const links = await Promise.all(
      entityIds.map(async (sourceId) => {
        const categoryPath = categoryPathOf(tree, Number(sourceId));
        // An unknown category would otherwise search unfiltered and report the whole catalog as
        // its products. One bad source yields nothing rather than failing the whole batch.
        if (!categoryPath) return { sourceId, targetIds: [], entityTotal: 0 };

        const { productIds, total } = await provider.searchProducts({
          categoryPath,
          from: pagination.offset,
          // `_to` is inclusive, so the last index is one below the exclusive end.
          to: pagination.offset + pagination.limit - 1,
          salesChannel: context.vtexSalesChannel,
        });

        return { sourceId, targetIds: productIds, entityTotal: total };
      })
    );

    return { links };
  },
});
