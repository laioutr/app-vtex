import {
  CategoryBySlugQuery,
  CategoryNotFoundError,
} from '@laioutr-core/canonical-types/ecommerce';
import { defineVtexQuery } from '../../middleware/defineVtex';
import { findBySlug, loadCategoryTree } from '../../vtex-helper/categoryTree';

export default defineVtexQuery(CategoryBySlugQuery, async ({ context, input }) => {
  // Resolved from the cached tree — one fetch, versus one request per candidate category.
  const node = findBySlug(await loadCategoryTree(context.vtexClient), input.slug);
  if (!node) throw new CategoryNotFoundError(input.slug);

  return { id: String(node.id) };
});
