import {
  CategoryNotFoundError,
  ProductsByCategorySlugQuery,
} from '@laioutr-core/canonical-types/ecommerce';
import { VtexApiError } from '../../client/types';
import { defineVtexQuery } from '../../middleware/defineVtex';
import { createLegacySearchProvider } from '../../search/legacy';
import { categoryPathOf, findBySlug, loadCategoryTree } from '../../vtex-helper/categoryTree';

export default defineVtexQuery(
  ProductsByCategorySlugQuery,
  async ({ context, input, pagination }) => {
    const tree = await loadCategoryTree(context.vtexClient);
    const node = findBySlug(tree, input.categorySlug);
    if (!node) throw new CategoryNotFoundError(input.categorySlug);

    try {
      const { productIds, total } = await createLegacySearchProvider(
        context.vtexClient
      ).searchProducts({
        categoryPath: categoryPathOf(tree, node.id),
        from: pagination.offset,
        to: pagination.offset + pagination.limit - 1,
        salesChannel: context.vtexSalesChannel,
      });

      return { ids: productIds, total };
    } catch (error) {
      // The cached tree can outlive a deleted category; VTEX answers 400 for one it does not know.
      if (error instanceof VtexApiError && error.status === 400) {
        throw new CategoryNotFoundError(input.categorySlug);
      }
      throw error;
    }
  }
);
