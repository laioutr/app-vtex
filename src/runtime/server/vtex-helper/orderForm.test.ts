import { describe, expect, it, vi } from 'vitest';
import { indexByUniqueId, parseOrderFormId, toBatchResults, toOrderItemUpdates } from './orderForm';
import type { VtexOrderForm, VtexOrderFormItem } from '../types/vtexCheckout';

const item = (over: Partial<VtexOrderFormItem>): VtexOrderFormItem => ({
  uniqueId: 'U1',
  id: '146835',
  productId: '146835',
  name: 'FILA Slip On Sneaker',
  quantity: 1,
  price: 4999,
  availability: 'available',
  ...over,
});

const orderForm = (
  items: VtexOrderFormItem[],
  messages: VtexOrderForm['messages'] = []
): VtexOrderForm => ({
  orderFormId: 'OF1',
  salesChannel: '1',
  value: items.reduce((sum, i) => sum + i.price * i.quantity, 0),
  items,
  messages,
  totalizers: [],
});

describe('parseOrderFormId', () => {
  it('strips the __ofid prefix VTEX wraps the id in', () => {
    expect(parseOrderFormId('__ofid=70542a28bdf143eda4178002d09d6b67')).toBe(
      '70542a28bdf143eda4178002d09d6b67'
    );
  });

  it('is undefined for an absent, empty or unprefixed cookie', () => {
    expect(parseOrderFormId(undefined)).toBeUndefined();
    expect(parseOrderFormId('')).toBeUndefined();
    expect(parseOrderFormId('__ofid=')).toBeUndefined();
    expect(parseOrderFormId('70542a28')).toBeUndefined();
  });
});

describe('indexByUniqueId', () => {
  it('maps each line to its position, which is the only thing VTEX accepts', () => {
    const map = indexByUniqueId(orderForm([item({ uniqueId: 'A' }), item({ uniqueId: 'B' })]));
    expect(map.get('A')).toBe(0);
    expect(map.get('B')).toBe(1);
  });
});

describe('toOrderItemUpdates', () => {
  const index = new Map([
    ['A', 0],
    ['B', 1],
  ]);

  it('translates a uniqueId to its index', () => {
    expect(toOrderItemUpdates([{ itemId: 'B', quantity: 3 }], index)).toEqual([
      { index: 1, quantity: 3 },
    ]);
  });

  it('skips a line that is already gone rather than moving another line s index', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(toOrderItemUpdates([{ itemId: 'GONE', quantity: 3 }], index)).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('GONE'));
    warn.mockRestore();
  });

  it('skips a row carrying no quantity, which the token documents as ignorable', () => {
    expect(toOrderItemUpdates([{ itemId: 'A' }], index)).toEqual([]);
  });
});

describe('toBatchResults', () => {
  const requested = [{ productId: '146835', variantId: '146835' }];

  it('reports a row VTEX accepted as added, with the quantity actually gained', () => {
    const before = orderForm([]);
    const after = orderForm([item({ quantity: 2 })]);
    expect(toBatchResults(requested, before, after)).toEqual([
      { status: 'added', productId: '146835', variantId: '146835', quantity: 2 },
    ]);
  });

  it('reports a clamped quantity as added, not as an error', () => {
    const before = orderForm([]);
    const after = orderForm(
      [item({ quantity: 50 })],
      [{ code: 'itemMaxQuantityLimitReached', text: 'You can t have more than 50', status: 'info' }]
    );
    expect(toBatchResults(requested, before, after)[0]).toMatchObject({
      status: 'added',
      quantity: 50,
    });
  });

  it('reports an unknown SKU as a rejected row, because VTEX answers 200 for it', () => {
    const before = orderForm([]);
    const after = orderForm(
      [],
      [
        {
          code: 'ORD027',
          text: 'Item 999999999 not found',
          status: 'error',
          fields: { id: '999999999' },
        },
      ]
    );
    expect(toBatchResults([{ productId: 'p', variantId: '999999999' }], before, after)).toEqual([
      { status: 'rejected', productId: 'p', variantId: '999999999', reason: 'not-found' },
    ]);
  });

  it('reports a line VTEX added but cannot fulfil as sold-out', () => {
    const before = orderForm([]);
    const after = orderForm([item({ availability: 'withoutStock' })]);
    expect(toBatchResults(requested, before, after)[0]).toMatchObject({
      status: 'rejected',
      reason: 'sold-out',
    });
  });

  it('counts only the gain, so adding to an existing line does not re-report it', () => {
    const before = orderForm([item({ quantity: 1 })]);
    const after = orderForm([item({ quantity: 3 })]);
    expect(toBatchResults(requested, before, after)[0]).toMatchObject({ quantity: 2 });
  });
});
