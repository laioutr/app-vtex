const CATEGORY_PREFIX = 'category:';
const PRODUCT_PREFIX = 'product:';

/**
 * BreadcrumbItem ids are shared across every source that builds a trail, so an item is namespaced
 * by what it points at rather than reusing the bare entity id.
 */
export const toCategoryBreadcrumbId = (categoryId: number | string) =>
  `${CATEGORY_PREFIX}${categoryId}`;

export const toProductBreadcrumbId = (productId: string) => `${PRODUCT_PREFIX}${productId}`;

export const categoryIdFromBreadcrumbId = (id: string): number | undefined => {
  if (!id.startsWith(CATEGORY_PREFIX)) return undefined;
  const parsed = Number(id.slice(CATEGORY_PREFIX.length));
  return Number.isFinite(parsed) ? parsed : undefined;
};

export const productIdFromBreadcrumbId = (id: string): string | undefined =>
  id.startsWith(PRODUCT_PREFIX) ? id.slice(PRODUCT_PREFIX.length) : undefined;

/**
 * VTEX reports a product's categories as id paths, deepest first: `['/1/2/3/4/', '/1/2/3/', …]`.
 * Reading ids straight off the path avoids guessing a category from its display name.
 */
export const categoryIdsFromPath = (path: string): number[] =>
  path
    .split('/')
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isFinite(n));
