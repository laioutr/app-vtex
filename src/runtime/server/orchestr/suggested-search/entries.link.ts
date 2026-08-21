import { SuggestedSearchEntriesLink } from '@laioutr-core/canonical-types/suggested-search';
import { defineVtexLink } from '../../middleware/defineVtex';
import { createLegacySearchProvider } from '../../search/legacy';
import { flatten, loadCategoryTree } from '../../vtex-helper/categoryTree';
import { seedProducts } from '../../vtex-helper/loadProducts';
import {
  toCategorySuggestionId,
  toProductSuggestionId,
} from '../../vtex-helper/suggestedSearch';

const CATEGORY_SUGGESTIONS = 3;
const PRODUCT_SUGGESTIONS = 5;

export default defineVtexLink({
  implements: SuggestedSearchEntriesLink,
  run: async ({ entityIds, context, passthrough }) => {
    const provider = createLegacySearchProvider(context.vtexClient);

    const links = await Promise.all(
      entityIds.map(async (term) => {
        const needle = term.trim().toLowerCase();
        if (!needle) return { sourceId: term, targetIds: [] };

        // Categories come from the tree already in memory; products need the catalog. VTEX offers
        // no autocomplete without Intelligent Search, so full-text search stands in for one.
        const [tree, found] = await Promise.all([
          loadCategoryTree(context.vtexClient),
          provider.searchProducts({
            term,
            from: 0,
            to: PRODUCT_SUGGESTIONS - 1,
            salesChannel: context.vtexSalesChannel,
          }),
        ]);

        seedProducts(passthrough, found.products);

        const categories = flatten(tree)
          .filter((node) => node.name.toLowerCase().includes(needle))
          .slice(0, CATEGORY_SUGGESTIONS)
          .map((node) => toCategorySuggestionId(node.id));

        return {
          sourceId: term,
          targetIds: [...categories, ...found.productIds.map(toProductSuggestionId)],
        };
      })
    );

    return { links };
  },
});
