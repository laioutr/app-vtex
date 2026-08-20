import { CategoryAllQuery } from '@laioutr-core/canonical-types/ecommerce';
import { defineVtexQuery } from '../../middleware/defineVtex';
import { flatten, loadCategoryTree } from '../../vtex-helper/categoryTree';

export default defineVtexQuery(CategoryAllQuery, async ({ context, pagination }) => {
  // VTEX returns the whole tree in one response, so paging happens here rather than upstream.
  const all = flatten(await loadCategoryTree(context.vtexClient));
  const offset = (pagination.page - 1) * pagination.limit;

  return { ids: all.slice(offset, offset + pagination.limit).map((n) => String(n.id)) };
});
