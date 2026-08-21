import {
  CategoryNotFoundError,
  ProductsByCategoryIdQuery,
} from '@laioutr-core/canonical-types/ecommerce';
import { VtexApiError } from '../../client/types';
import { defineVtexQuery } from '../../middleware/defineVtex';
import { createLegacySearchProvider } from '../../search/legacy';
import { categoryPathOf, findById, loadCategoryTree } from '../../vtex-helper/categoryTree';
import { seedProducts } from '../../vtex-helper/loadProducts';

export default defineVtexQuery(ProductsByCategoryIdQuery, async ({ context, input, pagination, passthrough }) => {
  const tree = await loadCategoryTree(context.vtexClient);
  // Without this the search runs unfiltered, which answers with the entire catalog rather than
  // nothing — an unknown category would look like a category holding every product.
  if (!findById(tree, Number(input.categoryId))) throw new CategoryNotFoundError(input.categoryId);

  try {
    const { productIds, total, products } = await createLegacySearchProvider(
      context.vtexClient
    ).searchProducts({
      categoryPath: categoryPathOf(tree, Number(input.categoryId)),
      from: pagination.offset,
      to: pagination.offset + pagination.limit - 1,
      salesChannel: context.vtexSalesChannel,
    });

    // The search response already carries every field the resolvers need.
    seedProducts(passthrough, products);

    return { ids: productIds, total };
  } catch (error) {
    // The cached tree can outlive a deleted category; VTEX answers 400 for one it does not know.
    if (error instanceof VtexApiError && error.status === 400) {
      throw new CategoryNotFoundError(input.categoryId);
    }
    throw error;
  }
});
