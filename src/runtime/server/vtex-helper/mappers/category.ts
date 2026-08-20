import { slugFromUrl, type VtexCategoryNode } from '../categoryTree';

export const toCategoryComponents = (node: VtexCategoryNode) => ({
  base: {
    title: node.name,
    slug: slugFromUrl(node.url),
  },
  seo: {
    // VTEX leaves Title null on root categories, where the display name is the honest fallback.
    title: node.Title || node.name,
    ...(node.MetaTagDescription ? { description: node.MetaTagDescription } : {}),
  },
});
