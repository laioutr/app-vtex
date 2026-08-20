import { ProductSearchQuery } from '@laioutr-core/canonical-types/ecommerce';
import { defineVtexQuery } from '../../middleware/defineVtex';
import { createLegacySearchProvider } from '../../search/legacy';

export default defineVtexQuery(ProductSearchQuery, async ({ context, input, pagination }) => {
  const { productIds, total } = await createLegacySearchProvider(context.vtexClient).searchProducts({
    term: input.query,
    from: pagination.offset,
    // `_to` is inclusive, so the last index sits one below the exclusive end.
    to: pagination.offset + pagination.limit - 1,
    salesChannel: context.vtexSalesChannel,
  });

  return { ids: productIds, total };
});
