import { describe, expect, it, vi } from 'vitest';
import {
  currencyOf,
  slugFromDetailUrl,
  toCartBase,
  toCartCost,
  toCartItemAvailability,
  toCartItemBase,
  toCartItemCost,
  toCartItemQuantityRule,
} from './cart';
import type { VtexOrderForm, VtexOrderFormItem } from '../../types/vtexCheckout';

const item = (over: Partial<VtexOrderFormItem> = {}): VtexOrderFormItem => ({
  uniqueId: 'U1',
  id: '756290',
  productId: '137327',
  name: 'Laioutr Test Sneaker',
  skuName: 'Laioutr Test Sneaker Rot 42',
  refId: 'LTS-42-ROT',
  quantity: 2,
  price: 5999,
  listPrice: 7999,
  priceDefinition: { calculatedSellingPrice: 5999, total: 11998 },
  imageUrl: 'https://x.vteximg.com.br/arquivos/ids/157422-55-55/756290-Rot.jpg?v=1',
  detailUrl: '/laioutr-test-sneaker/p',
  availability: 'available',
  unitMultiplier: 1,
  additionalInfo: { brandName: 'FILA' },
  ...over,
});

const orderForm = (over: Partial<VtexOrderForm> = {}): VtexOrderForm => ({
  orderFormId: 'OF1',
  salesChannel: '1',
  value: 11998,
  items: [item()],
  messages: [],
  totalizers: [{ id: 'Items', name: 'Items Total', value: 11998 }],
  storePreferencesData: { currencyCode: 'EUR' },
  ...over,
});

describe('currencyOf', () => {
  it('reads the currency VTEX priced the cart in', () => {
    expect(currencyOf(orderForm())).toBe('EUR');
  });

  it('is undefined when VTEX reports none', () => {
    expect(currencyOf(orderForm({ storePreferencesData: null }))).toBeUndefined();
  });
});

describe('slugFromDetailUrl', () => {
  it('takes the slug out of VTEX s detail path', () => {
    expect(slugFromDetailUrl('/laioutr-test-sneaker/p')).toBe('laioutr-test-sneaker');
  });

  it('is undefined for a path it does not recognise', () => {
    expect(slugFromDetailUrl(undefined)).toBeUndefined();
    expect(slugFromDetailUrl('/some/other/path')).toBeUndefined();
  });
});

describe('toCartBase', () => {
  it('sums the line quantities', () => {
    expect(
      toCartBase(orderForm({ items: [item({ quantity: 2 }), item({ quantity: 3 })] }), 'https://c')
        .totalQuantity
    ).toBe(5);
  });

  it('carries the checkout url as a link', () => {
    expect(toCartBase(orderForm(), 'https://c/checkout').checkoutLink).toEqual({
      type: 'url',
      href: 'https://c/checkout',
    });
  });
});

describe('toCartCost', () => {
  it('takes the subtotal from the Items totalizer and the total from the cart value', () => {
    const cost = toCartCost(orderForm(), 'EUR')!;
    expect(cost.subtotal.getAmount()).toBe(11998);
    expect(cost.total.getAmount()).toBe(11998);
  });

  it('estimates the total until a shipping address exists', () => {
    expect(toCartCost(orderForm(), 'EUR')!.totalIsEstimated).toBe(true);
    expect(
      toCartCost(orderForm({ shippingData: { selectedAddresses: [{}] } }), 'EUR')!.totalIsEstimated
    ).toBe(false);
  });

  it('omits shipping and tax when their totalizers are absent, which is the normal cart', () => {
    const cost = toCartCost(orderForm(), 'EUR')!;
    expect(cost.shipping).toBeUndefined();
    expect(cost.tax).toBeUndefined();
  });

  it('falls back to the summed line totals when the Items totalizer is missing', () => {
    expect(toCartCost(orderForm({ totalizers: [] }), 'EUR')!.subtotal.getAmount()).toBe(11998);
  });

  it('degrades to undefined on a currency ts-money cannot take, rather than throwing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(toCartCost(orderForm(), 'XYZ')).toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('toCartItemBase', () => {
  it('maps the identity fields a cart row shows', () => {
    const base = toCartItemBase(item());
    expect(base).toMatchObject({
      type: 'product',
      quantity: 2,
      title: 'Laioutr Test Sneaker',
      subtitle: 'Laioutr Test Sneaker Rot 42',
      brand: 'FILA',
      code: 'LTS-42-ROT',
    });
  });

  it('links to the product detail page', () => {
    expect(toCartItemBase(item()).link).toEqual({
      type: 'reference',
      reference: { type: 'Product', id: '137327', slug: 'laioutr-test-sneaker' },
    });
  });

  it('omits the link rather than failing the line when the detail url is unusable', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(toCartItemBase(item({ detailUrl: null })).link).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('U1'));
    warn.mockRestore();
  });

  it('omits a subtitle that only repeats the title', () => {
    expect(toCartItemBase(item({ skuName: 'Laioutr Test Sneaker' })).subtitle).toBeUndefined();
  });
});

describe('toCartItemCost', () => {
  it('prices from priceDefinition, never from sellingPrice', () => {
    const cost = toCartItemCost(item({ sellingPrice: 1 }), 'EUR')!;
    expect(cost.single.getAmount()).toBe(5999);
    expect(cost.total.getAmount()).toBe(11998);
  });

  it('strikes through the list price when it beats what the shopper pays', () => {
    expect(toCartItemCost(item(), 'EUR')!.singleStrikethrough?.getAmount()).toBe(7999);
  });

  it('has no strikethrough on a flat-priced line', () => {
    expect(toCartItemCost(item({ listPrice: 5999 }), 'EUR')!.singleStrikethrough).toBeUndefined();
  });

  it('drops a line VTEX priced with no priceDefinition instead of guessing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(toCartItemCost(item({ priceDefinition: null }), 'EUR')).toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('toCartItemAvailability', () => {
  it('is in stock only for VTEX s available', () => {
    expect(toCartItemAvailability(item()).status).toBe('inStock');
    expect(toCartItemAvailability(item({ availability: 'withoutStock' })).status).toBe('outOfStock');
  });
});

describe('toCartItemQuantityRule', () => {
  it('steps by the unit multiplier, and its minimum matches the step', () => {
    expect(toCartItemQuantityRule(item({ unitMultiplier: 6 }))).toEqual({
      min: 6,
      increment: 6,
      canChange: true,
    });
  });

  it('falls back to single units when VTEX reports no multiplier', () => {
    expect(toCartItemQuantityRule(item({ unitMultiplier: null }))).toEqual({
      min: 1,
      increment: 1,
      canChange: true,
    });
  });
});
