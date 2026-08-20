import { MenuByAliasQuery } from '@laioutr-core/canonical-types/ecommerce';
import { defineVtexQuery } from '../../middleware/defineVtex';
import { loadCategoryTree } from '../../vtex-helper/categoryTree';
import { menuNodes, toMenuItemId } from '../../vtex-helper/menuItems';

export default defineVtexQuery(MenuByAliasQuery, async ({ context, input }) => {
  const tree = await loadCategoryTree(context.vtexClient);

  // VTEX has no menu entity. The alias names the menu's root and the menu is everything below it:
  // `main` roots at the tree itself, so its items are the top-level categories and their
  // descendants; any other alias roots at the category with that slug.
  return {
    ids: menuNodes(tree, input.alias).map((node) => toMenuItemId(input.alias, node.id)),
  };
});
