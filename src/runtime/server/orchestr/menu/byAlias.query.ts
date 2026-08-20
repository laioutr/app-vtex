import { MenuByAliasQuery } from '@laioutr-core/canonical-types/ecommerce';
import { defineVtexQuery } from '../../middleware/defineVtex';
import { findBySlug, flatten, loadCategoryTree } from '../../vtex-helper/categoryTree';

export default defineVtexQuery(MenuByAliasQuery, async ({ context, input }) => {
  const tree = await loadCategoryTree(context.vtexClient);

  // VTEX has no menu entity; a menu is a subtree of the category tree, selected by the alias.
  const subtree = input.alias === 'main' ? tree : (findBySlug(tree, input.alias)?.children ?? []);

  return { ids: flatten(subtree).map((n) => String(n.id)) };
});
