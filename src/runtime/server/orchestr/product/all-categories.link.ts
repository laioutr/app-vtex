import { ProductAllCategoriesLink } from '@laioutr-core/canonical-types/ecommerce';
import { defineVtexLink } from '../../middleware/defineVtex';
import { categoryIdsFromPath } from '../../vtex-helper/breadcrumbItems';
import { loadProducts } from '../../vtex-helper/loadProducts';

export default defineVtexLink({
  implements: ProductAllCategoriesLink,
  run: async ({ entityIds, context, passthrough }) => {
    if (entityIds.length === 0) return { links: [] };

    const products = await loadProducts(context.vtexClient, passthrough, entityIds);

    return {
      links: entityIds.map((sourceId) => {
        // `categoriesIds` carries the ids outright, so no category has to be matched by name.
        const paths = products.find((p) => p.productId === sourceId)?.categoriesIds ?? [];
        const ids = [...new Set(paths.flatMap(categoryIdsFromPath))].map(String);

        return { sourceId, targetIds: ids, entityTotal: ids.length };
      }),
    };
  },
});
