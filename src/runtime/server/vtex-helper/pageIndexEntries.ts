import { slugFromUrl, type VtexCategoryNode } from './categoryTree';
import type { VtexProduct } from './mappers/product';
import type { PageIndexEntry } from '@laioutr-core/core-types/orchestr';

export const toProductPageEntry = (p: VtexProduct): PageIndexEntry => ({
  // linkText, never LinkId: the casing differs and only linkText resolves.
  params: { slug: p.linkText },
  subject: { type: 'Product', id: p.productId },
  meta: {
    title: p.productTitle || p.productName,
    ...(p.metaTagDescription ? { description: p.metaTagDescription } : {}),
    ...(p.items?.[0]?.images?.[0]?.imageUrl
      ? { previewImage: p.items[0].images![0].imageUrl }
      : {}),
  },
});

export const toCategoryPageEntry = (n: VtexCategoryNode): PageIndexEntry => ({
  params: { slug: slugFromUrl(n.url) },
  subject: { type: 'Category', id: String(n.id) },
  meta: {
    title: n.Title || n.name,
    ...(n.MetaTagDescription ? { description: n.MetaTagDescription } : {}),
  },
});
