import { MenuItemBase } from '@laioutr-core/canonical-types/entity/menuItem';
import { defineVtexComponentResolver } from '../../middleware/defineVtex';
import {
  ancestorsOf,
  findById,
  loadCategoryTree,
  slugFromUrl,
} from '../../vtex-helper/categoryTree';
import { menuNodes, parseMenuItemId, toMenuItemId } from '../../vtex-helper/menuItems';

export default defineVtexComponentResolver({
  label: 'VTEX Menu Connector',
  entityType: 'MenuItem',
  provides: [MenuItemBase],
  resolve: async ({ entityIds, context, $entity }) => {
    const parsed = entityIds
      .map((id) => ({ id, parts: parseMenuItemId(id) }))
      .filter((e): e is { id: string; parts: { alias: string; categoryId: number } } =>
        Boolean(e.parts)
      );

    if (parsed.length === 0) return { entities: [] };

    const tree = await loadCategoryTree(context.vtexClient);

    // The menu each item belongs to is read off its own id, so the relations below stay correct
    // however many menus one request renders.
    const scopes = new Map<string, Set<number>>();
    const scopeOf = (alias: string) => {
      const cached = scopes.get(alias);
      if (cached) return cached;

      const ids = new Set(menuNodes(tree, alias).map((n) => n.id));
      scopes.set(alias, ids);
      return ids;
    };

    const entities = parsed.flatMap(({ id, parts: { alias, categoryId } }) => {
      const node = findById(tree, categoryId);
      if (!node) return [];

      const scope = scopeOf(alias);
      const childIds = node.children
        .filter((child) => scope.has(child.id))
        .map((child) => toMenuItemId(alias, child.id));

      const parent = ancestorsOf(tree, node.id).at(-1);

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
            ...(parent && scope.has(parent.id)
              ? { parentId: toMenuItemId(alias, parent.id) }
              : {}),
          }),
        }),
      ];
    });

    return { entities };
  },
  cache: {
    // The runner's client-env prefix carries no market, so two markets sharing a language and
    // currency would otherwise share entries despite resolving different sales channels.
    getKeySuffix: (clientEnv) => clientEnv.market.slug,
    // Matches the category tree's own lifetime, so a cached component cannot outlive the tree it
    // was derived from. The alias is part of the entity id, so two menus never share an entry.
    ttl: '10 minutes',
  },
});
