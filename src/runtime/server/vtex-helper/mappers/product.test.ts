import { describe, expect, it } from 'vitest';
import { toProductComponents, type VtexProduct } from './product';

const product: VtexProduct = {
  productId: '146835',
  productName: 'Slip On Sneaker',
  linkText: 'slip-on-sneaker',
  description: '<p>Bequemer Slip On.</p>',
  productTitle: 'Slip On Sneaker kaufen',
  metaTagDescription: 'Slip On Sneaker im Sortiment.',
  brand: 'FILA',
  allSpecifications: ['Material'],
  Material: ['Leder'],
  items: [
    {
      itemId: '146835',
      name: 'Slip On Sneaker',
      images: [{ imageUrl: 'https://cdn.example/x.jpg', imageText: 'Seitenansicht' }],
      sellers: [{ commertialOffer: { Price: 49.99, ListPrice: 69.99, AvailableQuantity: 100 } }],
    },
  ],
};

describe('toProductComponents', () => {
  it('maps identity from the search response', () => {
    expect(toProductComponents(product, 'EUR').base).toEqual({
      name: 'Slip On Sneaker',
      slug: 'slip-on-sneaker',
    });
  });

  it('converts the decimal price to minor units', () => {
    const { prices } = toProductComponents(product, 'EUR');
    expect(prices!.price.getAmount()).toBe(4999);
    expect(prices!.price.getCurrency()).toBe('EUR');
  });

  it('treats a higher list price as a strikethrough and computes the saving', () => {
    const { prices } = toProductComponents(product, 'EUR');
    expect(prices!.strikethroughPrice!.getAmount()).toBe(6999);
    expect(prices!.isOnSale).toBe(true);
    expect(prices!.savingsPercent).toBe(29);
  });

  it('is not on sale when the list price only matches the price', () => {
    const notReduced = {
      ...product,
      items: [
        {
          ...product.items[0],
          sellers: [{ commertialOffer: { Price: 49.99, ListPrice: 49.99, AvailableQuantity: 1 } }],
        },
      ],
    };
    const { prices } = toProductComponents(notReduced, 'EUR');
    expect(prices!.isOnSale).toBe(false);
    expect(prices!.strikethroughPrice).toBeUndefined();
  });

  it('yields no prices for a product with no seller rather than inventing one', () => {
    const orphan = { ...product, items: [{ ...product.items[0], sellers: [] }] };
    expect(toProductComponents(orphan, 'EUR').prices).toBeUndefined();
  });

  it('maps images to a raw-provider media source and keeps the alt text', () => {
    const { media, info } = toProductComponents(product, 'EUR');
    expect(media.images).toEqual([
      {
        type: 'image',
        alt: 'Seitenansicht',
        sources: [{ provider: 'raw', src: 'https://cdn.example/x.jpg' }],
      },
    ]);
    expect(info.cover).toEqual(media.images[0]);
  });

  it('leaves the cover unset when the product has no image', () => {
    const noImages = { ...product, items: [{ ...product.items[0], images: [] }] };
    expect(toProductComponents(noImages, 'EUR').info.cover).toBeUndefined();
  });

  it('reads specification rows through allSpecifications', () => {
    expect(toProductComponents(product, 'EUR').specifications).toEqual({
      properties: [{ name: 'Material', value: 'Leder' }],
    });
  });

  it('omits specifications when VTEX lists none', () => {
    const bare = { ...product, allSpecifications: [] };
    expect(toProductComponents(bare, 'EUR').specifications).toEqual({});
  });

  it('prefers the product title for SEO and falls back to the name', () => {
    expect(toProductComponents(product, 'EUR').seo.title).toBe('Slip On Sneaker kaufen');
    expect(toProductComponents({ ...product, productTitle: null }, 'EUR').seo.title).toBe(
      'Slip On Sneaker'
    );
  });

  it('carries the brand', () => {
    expect(toProductComponents(product, 'EUR').brand).toEqual({ name: 'FILA' });
  });
});
