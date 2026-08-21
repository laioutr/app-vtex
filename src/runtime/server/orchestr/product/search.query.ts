import { ProductSearchQuery } from '@laioutr-core/canonical-types/ecommerce';
import { defineVtexQuery } from '../../middleware/defineVtex';
import { createLegacySearchProvider } from '../../search/legacy';
import { seedProducts } from '../../vtex-helper/loadProducts';

export default defineVtexQuery(
  ProductSearchQuery,
  async ({ context, input, pagination, passthrough }) => {
    const { productIds, total, products } = await createLegacySearchProvider(
      context.vtexClient
    ).searchProducts({
      term: input.query,
      from: pagination.offset,
      // `_to` is inclusive, so the last index sits one below the exclusive end.
      to: pagination.offset + pagination.limit - 1,
      salesChannel: context.vtexSalesChannel,
    });

    // The search response already carries every field the resolvers need.
    seedProducts(passthrough, products);

    return { ids: productIds, total };
  }
);
