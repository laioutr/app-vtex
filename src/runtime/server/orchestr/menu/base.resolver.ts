import { MenuItemBase } from '@laioutr-core/canonical-types/entity/menuItem';
import { menuItemIdsToken } from '../../const/passthroughTokens';
import { defineVtexComponentResolver } from '../../middleware/defineVtex';
import {
  ancestorsOf,
  findById,
  loadCategoryTree,
  slugFromUrl,
} from '../../vtex-helper/categoryTree';

export default defineVtexComponentResolver({
  label: 'VTEX Menu Connector',
  entityType: 'MenuItem',
  provides: [MenuItemBase],
  resolve: async ({ entityIds, context, passthrough, $entity }) => {
    const tree = await loadCategoryTree(context.vtexClient);

    // Absent when something other than the menu query asked for these items; then every relation
    // the tree knows about is reported, since there is no menu to bound them by.
    const menuIds = passthrough.get(menuItemIdsToken);
    const inMenu = (id: string) => !menuIds || menuIds.includes(id);

    const entities = entityIds.flatMap((id) => {
      const node = findById(tree, Number(id));
      if (!node) return [];

      const parent = ancestorsOf(tree, node.id).at(-1);
      const childIds = node.children.map((c) => String(c.id)).filter(inMenu);

      return [
        $entity({
          id,
          base: () => ({
            type: 'link' as const,
            name: node.name,
            link: {
              type: 'reference' as const,
              reference: {
                type: 'Category' as const,
                slug: slugFromUrl(node.url),
                id: String(node.id),
              },
            },
            ...(childIds.length ? { childIds } : {}),
            // An item whose parent sits outside the menu is where the menu starts.
            ...(parent && inMenu(String(parent.id)) ? { parentId: String(parent.id) } : {}),
          }),
        }),
      ];
    });

    return { entities };
  },
});
