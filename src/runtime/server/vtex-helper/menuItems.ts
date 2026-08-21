import { findBySlug, flatten, type VtexCategoryNode } from './categoryTree';

/**
 * A menu item is a category *within a menu*, not a category outright: the same category sits at the
 * top of one menu and halfway down another, with different parents and children each time. The id
 * therefore carries the alias, which also keeps two menus from sharing a cache entry — the
 * component cache keys on the entity id, and nothing else about a request identifies the menu.
 */
export const toMenuItemId = (alias: string, categoryId: number | string) => `${alias}:${categoryId}`;

export const parseMenuItemId = (id: string): { alias: string; categoryId: number } | undefined => {
  const separator = id.lastIndexOf(':');
  if (separator <= 0) return undefined;

  const categoryId = Number(id.slice(separator + 1));
  if (!Number.isFinite(categoryId)) return undefined;

  return { alias: id.slice(0, separator), categoryId };
};

/** The categories a menu covers: `main` spans the whole tree, any other alias its root's descendants. */
export const menuNodes = (tree: VtexCategoryNode[], alias: string): VtexCategoryNode[] =>
  flatten(alias === 'main' ? tree : (findBySlug(tree, alias)?.children ?? []));
