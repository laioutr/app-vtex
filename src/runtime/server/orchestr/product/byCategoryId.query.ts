import { ProductsByCategoryIdQuery } from '@laioutr-core/canonical-types/ecommerce';
import { defineVtexQuery } from '../../middleware/defineVtex';
import { createLegacySearchProvider } from '../../search/legacy';
import { categoryPathOf, loadCategoryTree } from '../../vtex-helper/categoryTree';

export default defineVtexQuery(ProductsByCategoryIdQuery, async ({ context, input, pagination }) => {
  const tree = await loadCategoryTree(context.vtexClient);

  const { productIds, total } = await createLegacySearchProvider(context.vtexClient).searchProducts({
    categoryPath: categoryPathOf(tree, Number(input.categoryId)),
    from: pagination.offset,
    to: pagination.offset + pagination.limit - 1,
    salesChannel: context.vtexSalesChannel,
  });

  return { ids: productIds, total };
});
