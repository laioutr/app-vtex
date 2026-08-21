import { defineCachedFunction } from '#imports';
import type { VtexClient } from '../client/types';
import type { VtexCatalogCategoryTree } from '../types/vtexCatalog';

/**
 * VTEX's own schema for a tree node, with two fields corrected against the live account: it marks
 * `Title` and `MetaTagDescription` as required strings, while root categories return null for the
 * first and every category returns null for the second. Taking the schema at its word would make
 * the fallbacks downstream look like dead code.
 */
export type VtexCategoryNode = Omit<
  VtexCatalogCategoryTree,
  'children' | 'Title' | 'MetaTagDescription'
> & {
  children: VtexCategoryNode[];
  Title?: string | null;
  MetaTagDescription?: string | null;
};

/**
 * The whole URL path, not its last segment: category names repeat across the tree — this catalog
 * carries three separate "Sport" and "Bekleidung" categories under Damen, Herren and Kinder — so a
 * last-segment slug would address several categories at once.
 */
export const slugFromUrl = (url: string): string =>
  url.replace(/^https?:\/\/[^/]+/, '').replace(/^\/+|\/+$/g, '');

interface CategoryIndex {
  flat: VtexCategoryNode[];
  byId: Map<number, VtexCategoryNode>;
  bySlug: Map<string, VtexCategoryNode>;
  parentOf: Map<number, VtexCategoryNode>;
}

/**
 * Derived once per tree and held against the tree itself, so the lookups below cost a map read
 * rather than a fresh traversal each. Every handler resolves the tree once and then asks about it
 * repeatedly — a category per listed product, a node per menu item — which without this is a walk
 * of the whole tree per question. Keyed weakly because the entry is worthless once the tree it
 * describes is gone, and safe because nothing mutates a tree after it is fetched.
 */
const indexes = new WeakMap<VtexCategoryNode[], CategoryIndex>();

const indexOf = (nodes: VtexCategoryNode[]): CategoryIndex => {
  const existing = indexes.get(nodes);
  if (existing) return existing;

  const index: CategoryIndex = {
    flat: [],
    byId: new Map(),
    bySlug: new Map(),
    parentOf: new Map(),
  };

  const visit = (current: VtexCategoryNode[], parent?: VtexCategoryNode) => {
    for (const node of current) {
      index.flat.push(node);
      index.byId.set(node.id, node);
      // First writer wins, matching the find() this replaces.
      if (!index.bySlug.has(slugFromUrl(node.url))) index.bySlug.set(slugFromUrl(node.url), node);
      if (parent) index.parentOf.set(node.id, parent);

      visit(node.children ?? [], node);
    }
  };

  visit(nodes);
  indexes.set(nodes, index);

  return index;
};

/** A copy, because callers have always been free to sort or splice what they get back. */
export const flatten = (nodes: VtexCategoryNode[]): VtexCategoryNode[] => [...indexOf(nodes).flat];

export const findBySlug = (nodes: VtexCategoryNode[], slug: string) =>
  indexOf(nodes).bySlug.get(slug);

export const findById = (nodes: VtexCategoryNode[], id: number) => indexOf(nodes).byId.get(id);

/** Follows the parent chain, so the cost is the node's depth rather than the size of the tree. */
export const ancestorsOf = (nodes: VtexCategoryNode[], id: number): VtexCategoryNode[] => {
  const { byId, parentOf } = indexOf(nodes);
  if (!byId.has(id)) return [];

  const trail: VtexCategoryNode[] = [];
  for (let parent = parentOf.get(id); parent; parent = parentOf.get(parent.id)) {
    trail.unshift(parent);
  }

  return trail;
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
