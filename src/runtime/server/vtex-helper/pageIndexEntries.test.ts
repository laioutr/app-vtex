import { describe, expect, it } from 'vitest';
import { toCategoryPageEntry, toProductPageEntry } from './pageIndexEntries';
import type { VtexCategoryNode } from './categoryTree';
import type { VtexProduct } from './mappers/product';

const product: VtexProduct = {
  productId: '285',
  productName: 'Flache Pantolette',
  linkText: 'flache-pantolette',
  items: [],
};

const category: VtexCategoryNode = {
  id: 4,
  name: 'Flache Pantoletten',
  url: 'https://shop.example/damen/schuhe/pantoletten/flache-pantoletten',
  children: [],
  hasChildren: false,
};

describe('toProductPageEntry', () => {
  it('keys the entry on linkText, the addressable slug', () => {
    expect(toProductPageEntry(product)).toEqual({
      params: { slug: 'flache-pantolette' },
      subject: { type: 'Product', id: '285' },
      meta: { title: 'Flache Pantolette' },
    });
  });

  it('carries the first image as the preview when present', () => {
    const entry = toProductPageEntry({
      ...product,
      items: [{ itemId: '1917', name: 'x', images: [{ imageUrl: 'https://cdn/x.jpg' }] }],
    });
    expect(entry.meta.previewImage).toBe('https://cdn/x.jpg');
  });
});

describe('toCategoryPageEntry', () => {
  it('keys the entry on the full-path category slug', () => {
    expect(toCategoryPageEntry(category)).toEqual({
      params: { slug: 'damen/schuhe/pantoletten/flache-pantoletten' },
      subject: { type: 'Category', id: '4' },
      meta: { title: 'Flache Pantoletten' },
    });
  });

  it('prefers the VTEX page title', () => {
    expect(toCategoryPageEntry({ ...category, Title: 'Flache Pantoletten kaufen' }).meta.title).toBe(
      'Flache Pantoletten kaufen'
    );
  });
});
