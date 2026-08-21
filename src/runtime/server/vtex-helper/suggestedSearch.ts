const PRODUCT_PREFIX = 'product:';
const CATEGORY_PREFIX = 'category:';

/**
 * A SuggestedSearch is the term itself: the query is single, so the term is the only thing that
 * identifies it, and the links hang their results off it.
 */
export const toSuggestedSearchId = (term: string) => term;

export const toProductSuggestionId = (productId: string) => `${PRODUCT_PREFIX}${productId}`;
export const toCategorySuggestionId = (categoryId: number | string) =>
  `${CATEGORY_PREFIX}${categoryId}`;

export const parseSuggestionId = (
  id: string
): { kind: 'product' | 'category'; value: string } | undefined => {
  if (id.startsWith(PRODUCT_PREFIX))
    return { kind: 'product', value: id.slice(PRODUCT_PREFIX.length) };
  if (id.startsWith(CATEGORY_PREFIX))
    return { kind: 'category', value: id.slice(CATEGORY_PREFIX.length) };
  return undefined;
};
