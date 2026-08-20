import { defineCachedFunction } from '#imports';
import type { VtexClient } from '../client/types';

export interface VtexCategoryNode {
  id: number;
  name: string;
  url: string;
  children: VtexCategoryNode[];
  hasChildren: boolean;
  /** Page title; VTEX leaves it null on root categories. */
  Title?: string | null;
  MetaTagDescription?: string | null;
}

/**
 * The whole URL path, not its last segment: category names repeat across the tree — this catalog
 * carries three separate "Sport" and "Bekleidung" categories under Damen, Herren and Kinder — so a
 * last-segment slug would address several categories at once.
 */
export const slugFromUrl = (url: string): string =>
  url.replace(/^https?:\/\/[^/]+/, '').replace(/^\/+|\/+$/g, '');

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

/**
 * Slash-free on both ends, because VTEX rejects the alternatives: `fq=C:/2` answers 400, and a
 * trailing slash on a nested path — `fq=C:/2/3/4/` — matches nothing at all while still returning
 * 200, so the mistake surfaces as an empty listing rather than an error.
 */
export const categoryPathOf = (nodes: VtexCategoryNode[], id: number): string => {
  const node = findById(nodes, id);
  if (!node) return '';
  return [...ancestorsOf(nodes, id), node].map((n) => n.id).join('/');
};

/**
 * The depth is deliberately far past any real tree: VTEX clamps it to the depth that exists, so an
 * over-estimate costs nothing while an under-estimate drops the levels below it without a word.
 *
 * Cached for ten minutes: the tree changes rarely, and VTEX offers no invalidation hook to key a
 * shorter-lived cache off.
 */
export const loadCategoryTree = defineCachedFunction(
  async (client: VtexClient) =>
    client.publicFetch<VtexCategoryNode[]>(
      'catalogSystem',
      '/api/catalog_system/pub/category/tree/50'
    ),
  { maxAge: 600, name: 'vtex-category-tree', getKey: () => 'tree' }
);
