import {
  CategoryNotFoundError,
  ProductsByCategorySlugQuery,
} from '@laioutr-core/canonical-types/ecommerce';
import { defineVtexQuery } from '../../middleware/defineVtex';
import { createLegacySearchProvider } from '../../search/legacy';
import { categoryPathOf, findBySlug, loadCategoryTree } from '../../vtex-helper/categoryTree';

export default defineVtexQuery(
  ProductsByCategorySlugQuery,
  async ({ context, input, pagination }) => {
    const tree = await loadCategoryTree(context.vtexClient);
    const node = findBySlug(tree, input.categorySlug);
    if (!node) throw new CategoryNotFoundError(input.categorySlug);

    const { productIds, total } = await createLegacySearchProvider(
      context.vtexClient
    ).searchProducts({
      categoryPath: categoryPathOf(tree, node.id),
      from: pagination.offset,
      to: pagination.offset + pagination.limit - 1,
      salesChannel: context.vtexSalesChannel,
    });

    return { ids: productIds, total };
  }
);
