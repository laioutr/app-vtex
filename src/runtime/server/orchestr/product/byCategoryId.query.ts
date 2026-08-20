import {
  CategoryNotFoundError,
  ProductsByCategoryIdQuery,
} from '@laioutr-core/canonical-types/ecommerce';
import { VtexApiError } from '../../client/types';
import { defineVtexQuery } from '../../middleware/defineVtex';
import { createLegacySearchProvider } from '../../search/legacy';
import { categoryPathOf, findById, loadCategoryTree } from '../../vtex-helper/categoryTree';

export default defineVtexQuery(ProductsByCategoryIdQuery, async ({ context, input, pagination }) => {
  const tree = await loadCategoryTree(context.vtexClient);
  // Without this the search runs unfiltered, which answers with the entire catalog rather than
  // nothing — an unknown category would look like a category holding every product.
  if (!findById(tree, Number(input.categoryId))) throw new CategoryNotFoundError(input.categoryId);

  try {
    const { productIds, total } = await createLegacySearchProvider(
      context.vtexClient
    ).searchProducts({
      categoryPath: categoryPathOf(tree, Number(input.categoryId)),
      from: pagination.offset,
      to: pagination.offset + pagination.limit - 1,
      salesChannel: context.vtexSalesChannel,
    });

    return { ids: productIds, total };
  } catch (error) {
    // The cached tree can outlive a deleted category; VTEX answers 400 for one it does not know.
    if (error instanceof VtexApiError && error.status === 400) {
      throw new CategoryNotFoundError(input.categoryId);
    }
    throw error;
  }
});
