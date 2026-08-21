import { describe, expect, it } from 'vitest';
import { checkoutUrlFor } from './checkoutUrl';

describe('checkoutUrlFor', () => {
  it('carries the orderForm id, because VTEX s domain cannot read our cookie', () => {
    expect(checkoutUrlFor('laioutrpartner', 'vtexcommercestable', 'OF1')).toBe(
      'https://laioutrpartner.vtexcommercestable.com.br/checkout/?orderFormId=OF1#/cart'
    );
  });

  it('falls back to a bare checkout when the shopper has no cart', () => {
    expect(checkoutUrlFor('laioutrpartner', 'vtexcommercestable')).toBe(
      'https://laioutrpartner.vtexcommercestable.com.br/checkout/#/cart'
    );
  });
});
