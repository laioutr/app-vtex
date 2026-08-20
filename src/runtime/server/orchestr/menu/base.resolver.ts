import { MenuItemBase } from '@laioutr-core/canonical-types/entity/menuItem';
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
  resolve: async ({ entityIds, context, $entity }) => {
    const tree = await loadCategoryTree(context.vtexClient);

    const entities = entityIds.flatMap((id) => {
      const node = findById(tree, Number(id));
      if (!node) return [];

      const ancestors = ancestorsOf(tree, node.id);

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
            ...(node.children.length ? { childIds: node.children.map((c) => String(c.id)) } : {}),
            ...(ancestors.length ? { parentId: String(ancestors[ancestors.length - 1].id) } : {}),
          }),
        }),
      ];
    });

    return { entities };
  },
});
