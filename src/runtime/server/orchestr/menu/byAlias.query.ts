import { MenuByAliasQuery } from '@laioutr-core/canonical-types/ecommerce';
import { menuItemIdsToken } from '../../const/passthroughTokens';
import { defineVtexQuery } from '../../middleware/defineVtex';
import { findBySlug, flatten, loadCategoryTree } from '../../vtex-helper/categoryTree';

export default defineVtexQuery(MenuByAliasQuery, async ({ context, input, passthrough }) => {
  const tree = await loadCategoryTree(context.vtexClient);

  // VTEX has no menu entity. The alias names the menu's root and the menu is everything below it:
  // `main` roots at the tree itself, so its items are the top-level categories and their
  // descendants; any other alias roots at the category with that slug.
  const subtree = input.alias === 'main' ? tree : (findBySlug(tree, input.alias)?.children ?? []);
  const ids = flatten(subtree).map((n) => String(n.id));

  // Lets the resolver tell a parent inside this menu from one merely above it in the tree.
  passthrough.set(menuItemIdsToken, ids);

  return { ids };
});
