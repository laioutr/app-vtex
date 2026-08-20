import { ProductListingPage } from '@laioutr-core/canonical-types/ecommerce';
import { defineVtexPageIndex } from '../../middleware/defineVtex';
import { findBySlug, flatten, loadCategoryTree } from '../../vtex-helper/categoryTree';
import { toCategoryPageEntry } from '../../vtex-helper/pageIndexEntries';

/** The whole tree arrives in one cached request, so the walk needs no cursor. */
export default defineVtexPageIndex({
  for: ProductListingPage,
  label: 'VTEX Category',
  batchSize: 500,
  cache: { ttl: '1h', search: { ttl: '10m' }, locate: { ttl: '1h' } },

  locate: async ({ context, params }) => {
    const node = findBySlug(await loadCategoryTree(context.vtexClient), params.slug);
    if (!node) return undefined;

    const entry = toCategoryPageEntry(node);
    return { subject: entry.subject, meta: entry.meta };
  },

  count: async ({ context }) => flatten(await loadCategoryTree(context.vtexClient)).length,

  search: async ({ context, term, take }) =>
    flatten(await loadCategoryTree(context.vtexClient))
      .filter((n) => n.name.toLowerCase().includes(term.toLowerCase()))
      .slice(0, take)
      .map(toCategoryPageEntry),

  list: async ({ context }) =>
    flatten(await loadCategoryTree(context.vtexClient)).map(toCategoryPageEntry),
});
