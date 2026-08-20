const CATEGORY_PREFIX = 'category:';

/**
 * BreadcrumbItem ids are shared across every source that builds a trail, so a category's item is
 * namespaced rather than reusing the bare category id.
 */
export const toCategoryBreadcrumbId = (categoryId: number | string) =>
  `${CATEGORY_PREFIX}${categoryId}`;

export const categoryIdFromBreadcrumbId = (id: string): number | undefined => {
  if (!id.startsWith(CATEGORY_PREFIX)) return undefined;
  const parsed = Number(id.slice(CATEGORY_PREFIX.length));
  return Number.isFinite(parsed) ? parsed : undefined;
};
