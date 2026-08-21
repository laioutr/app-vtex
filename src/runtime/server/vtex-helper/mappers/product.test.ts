import { describe, expect, it } from 'vitest';
import { toProductComponents, toProductOptionGroups, type VtexProduct } from './product';

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

  it('prices a single-SKU product outright rather than as a floor', () => {
    expect(toProductComponents(product, 'EUR').prices!.isStartingFrom).toBe(false);
  });

  it('takes the cheapest SKU when they disagree, and says the price is a floor', () => {
    const mixed = {
      ...product,
      items: [
        {
          ...product.items[0],
          itemId: '1',
          sellers: [{ commertialOffer: { Price: 69.99, ListPrice: 69.99, AvailableQuantity: 5 } }],
        },
        {
          ...product.items[0],
          itemId: '2',
          sellers: [{ commertialOffer: { Price: 59.99, ListPrice: 79.99, AvailableQuantity: 5 } }],
        },
      ],
    };
    const { prices } = toProductComponents(mixed, 'EUR');
    expect(prices!.price.getAmount()).toBe(5999);
    expect(prices!.isStartingFrom).toBe(true);
    // The strikethrough belongs to the SKU that set the price, not to some other one.
    expect(prices!.strikethroughPrice!.getAmount()).toBe(7999);
  });

  it('is not a floor when every SKU costs the same', () => {
    const uniform = {
      ...product,
      items: [
        {
          ...product.items[0],
          itemId: '1',
          sellers: [{ commertialOffer: { Price: 49.99, ListPrice: null, AvailableQuantity: 5 } }],
        },
        {
          ...product.items[0],
          itemId: '2',
          sellers: [{ commertialOffer: { Price: 49.99, ListPrice: null, AvailableQuantity: 5 } }],
        },
      ],
    };
    expect(toProductComponents(uniform, 'EUR').prices!.isStartingFrom).toBe(false);
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
        sources: [{ provider: 'vtex', src: 'https://cdn.example/x.jpg' }],
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

describe('toProductOptionGroups', () => {
  const sku = (itemId: string, farbe: string, groesse: string, qty: number) => ({
    itemId,
    name: `Sneaker ${farbe} ${groesse}`,
    variations: ['Farbe', 'Groesse'],
    Farbe: [farbe],
    Groesse: [groesse],
    sellers: [{ commertialOffer: { Price: 10, ListPrice: null, AvailableQuantity: qty } }],
  });

  const multi: VtexProduct = {
    ...product,
    items: [sku('1', 'Rot', '41', 5), sku('2', 'Blau', '42', 0), sku('3', 'Rot', '42', 7)],
  };

  it('aggregates each axis across the SKUs, in the order first seen', () => {
    const { groups } = toProductOptionGroups(multi);
    expect(groups.map((g) => g.name)).toEqual(['Farbe', 'Groesse']);
    expect(groups[0].values.map((v) => v.value)).toEqual(['Rot', 'Blau']);
    expect(groups[1].values.map((v) => v.value)).toEqual(['41', '42']);
  });

  it('points each value at a SKU that offers it', () => {
    const farbe = toProductOptionGroups(multi).groups[0];
    expect(farbe.values.find((v) => v.value === 'Rot')?.variantId).toBe('1');
    expect(farbe.values.find((v) => v.value === 'Blau')?.variantId).toBe('2');
  });

  it('marks a value available when any SKU offering it is in stock', () => {
    const groesse = toProductOptionGroups(multi).groups[1];
    // 42 appears on a sold-out SKU first and a stocked one after; the stocked one wins.
    expect(groesse.values.find((v) => v.value === '42')).toEqual({
      value: '42',
      variantId: '3',
      available: true,
    });
  });

  it('marks a value unavailable when every SKU offering it is sold out', () => {
    const soldOut = { ...multi, items: [sku('1', 'Rot', '41', 0)] };
    expect(toProductOptionGroups(soldOut).groups[0].values[0].available).toBe(false);
  });

  it('yields no groups for a product VTEX declares no axes for', () => {
    expect(toProductOptionGroups(product).groups).toEqual([]);
  });
});
