import { SuggestedSearchProductsLink } from '@laioutr-core/canonical-types/suggested-search';
import { defineVtexLink } from '../../middleware/defineVtex';
import { createLegacySearchProvider } from '../../search/legacy';
import { seedProducts } from '../../vtex-helper/loadProducts';

export default defineVtexLink({
  implements: SuggestedSearchProductsLink,
  run: async ({ entityIds, context, pagination, passthrough }) => {
    const provider = createLegacySearchProvider(context.vtexClient);
    const limit = pagination?.limit ?? 5;
    const offset = pagination?.offset ?? 0;

    const links = await Promise.all(
      entityIds.map(async (term) => {
        // Intelligent Search would answer this; without it, full-text search over the catalog is
        // the closest thing VTEX offers, and it returns the products a shopper is reaching for.
        if (!term.trim()) return { sourceId: term, targetIds: [], entityTotal: 0 };

        const { productIds, total, products } = await provider.searchProducts({
          term,
          from: offset,
          to: offset + limit - 1,
          salesChannel: context.vtexSalesChannel,
        });

        seedProducts(passthrough, products);

        return { sourceId: term, targetIds: productIds, entityTotal: total };
      })
    );

    return { links };
  },
});
