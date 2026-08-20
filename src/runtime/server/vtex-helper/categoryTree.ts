import { defineCachedFunction } from '#imports';
import type { VtexClient } from '../client/types';

export interface VtexCategoryNode {
  id: number;
  name: string;
  url: string;
  children: VtexCategoryNode[];
  hasChildren: boolean;
}

/** VTEX returns an absolute storefront URL; the storefront addresses categories by last segment. */
export const slugFromUrl = (url: string): string => {
  const path = url.replace(/\/+$/, '');
  return path.slice(path.lastIndexOf('/') + 1);
};

export const flatten = (nodes: VtexCategoryNode[]): VtexCategoryNode[] =>
  nodes.flatMap((n) => [n, ...flatten(n.children ?? [])]);

export const findBySlug = (nodes: VtexCategoryNode[], slug: string) =>
  flatten(nodes).find((n) => slugFromUrl(n.url) === slug);

export const findById = (nodes: VtexCategoryNode[], id: number) =>
  flatten(nodes).find((n) => n.id === id);

/** Walks the tree once rather than issuing a request per ancestor. */
export const ancestorsOf = (nodes: VtexCategoryNode[], id: number): VtexCategoryNode[] => {
  const walk = (
    current: VtexCategoryNode[],
    trail: VtexCategoryNode[]
  ): VtexCategoryNode[] | undefined => {
    for (const n of current) {
      if (n.id === id) return trail;
      const hit = walk(n.children ?? [], [...trail, n]);
      if (hit) return hit;
    }
    return undefined;
  };
  return walk(nodes, []) ?? [];
};

export const categoryPathOf = (nodes: VtexCategoryNode[], id: number): string => {
  const node = findById(nodes, id);
  if (!node) return '';
  return `/${[...ancestorsOf(nodes, id), node].map((n) => n.id).join('/')}/`;
};

/**
 * Depth 5 covers every level this catalog uses. Cached for ten minutes: the tree changes rarely,
 * and VTEX offers no invalidation hook to key a shorter-lived cache off.
 */
export const loadCategoryTree = defineCachedFunction(
  async (client: VtexClient) =>
    client.publicFetch<VtexCategoryNode[]>(
      'catalogSystem',
      '/api/catalog_system/pub/category/tree/5'
    ),
  { maxAge: 600, name: 'vtex-category-tree', getKey: () => 'tree' }
);
