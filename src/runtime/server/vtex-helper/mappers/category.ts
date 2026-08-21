import { slugFromUrl, type VtexCategoryNode } from '../categoryTree';

export const toCategoryBase = (node: VtexCategoryNode) => ({
  title: node.name,
  slug: slugFromUrl(node.url),
});

export const toCategorySeo = (node: VtexCategoryNode) => ({
  // VTEX leaves Title null on root categories, where the display name is the honest fallback.
  title: node.Title || node.name,
  ...(node.MetaTagDescription ? { description: node.MetaTagDescription } : {}),
});

/**
 * VTEX keeps a category description on the admin record only — the public tree carries none — so a
 * caller that has not fetched one gets an empty fragment rather than no component. The storefront
 * asks for `content` on a category hero and not on a card grid, so the read is worth making only
 * when it is asked for.
 */
export const toCategoryContent = (description?: string | null) => ({
  description: { html: description ?? '' },
});

/** VTEX models no imagery on a category, in the tree or on the admin record. */
export const toCategoryMedia = () => ({ media: [] });

export const toCategoryComponents = (node: VtexCategoryNode) => ({
  base: toCategoryBase(node),
  seo: toCategorySeo(node),
  content: toCategoryContent(),
  media: toCategoryMedia(),
});
