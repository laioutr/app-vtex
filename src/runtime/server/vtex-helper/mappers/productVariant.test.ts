import { describe, expect, it } from 'vitest';
import { toVariantComponents } from './productVariant';
import type { VtexItem } from './product';

const item: VtexItem = {
  itemId: '1917',
  name: 'Graceland Flache Pantolette - Rosa - Größe 41',
  ean: '',
  images: [{ imageUrl: 'https://cdn.example/1917.jpg', imageLabel: 'Rosa' }],
  sellers: [{ commertialOffer: { Price: 1.99, ListPrice: 2.99, AvailableQuantity: 10 } }],
  variations: ['Farbe', 'Größe'],
  Farbe: ['Rosa'],
  'Größe': ['41'],
};

describe('toVariantComponents', () => {
  it('keys the variant on the SKU id', () => {
    expect(toVariantComponents(item, 'EUR').base).toEqual({
      sku: '1917',
      name: 'Graceland Flache Pantolette - Rosa - Größe 41',
    });
  });

  it('treats an empty EAN as no GTIN at all', () => {
    expect(toVariantComponents(item, 'EUR').base).not.toHaveProperty('gtin');
    expect(toVariantComponents({ ...item, ean: '4006680012345' }, 'EUR').base.gtin).toBe(
      '4006680012345'
    );
  });

  it('reads the selected options through the variations index', () => {
    expect(toVariantComponents(item, 'EUR').options.selected).toEqual([
      { name: 'Farbe', value: 'Rosa' },
      { name: 'Größe', value: '41' },
    ]);
  });

  it('selects nothing when VTEX declares no axes', () => {
    expect(toVariantComponents({ ...item, variations: null }, 'EUR').options.selected).toEqual([]);
  });

  it('reports stock from the seller offer', () => {
    expect(toVariantComponents(item, 'EUR').availability).toEqual({
      status: 'inStock',
      quantity: 10,
    });
  });

  it('is out of stock when the offer has no quantity', () => {
    const empty = {
      ...item,
      sellers: [{ commertialOffer: { Price: 1.99, ListPrice: null, AvailableQuantity: 0 } }],
    };
    expect(toVariantComponents(empty, 'EUR').availability).toEqual({
      status: 'outOfStock',
      quantity: 0,
    });
  });

  it('converts the price and marks the reduction', () => {
    const { prices } = toVariantComponents(item, 'EUR');
    expect(prices!.price.getAmount()).toBe(199);
    expect(prices!.strikethroughPrice!.getAmount()).toBe(299);
    expect(prices!.isOnSale).toBe(true);
  });

  it('yields no prices for a SKU no seller offers', () => {
    expect(toVariantComponents({ ...item, sellers: [] }, 'EUR').prices).toBeUndefined();
  });
});
