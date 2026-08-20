import { ProductSearchPage } from '@laioutr-core/canonical-types/ecommerce';
import { defineVtexPageIndex } from '../../middleware/defineVtex';

/**
 * The search page is one route whose term is a query parameter, not a page per term — so it
 * enumerates a single entry and locates unconditionally.
 */
export default defineVtexPageIndex({
  for: ProductSearchPage,
  label: 'VTEX Search',
  batchSize: 1,
  cache: { ttl: '1 day' },

  locate: async () => ({ meta: { title: 'Search' } }),
  count: async () => 1,
  list: async () => [{ params: {}, meta: { title: 'Search' } }],
});
