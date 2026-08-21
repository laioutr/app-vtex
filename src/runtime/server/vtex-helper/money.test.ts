import { describe, expect, it } from 'vitest';
import { fromDecimal, fromMinorUnits } from './money';

describe('fromMinorUnits', () => {
  it('treats the input as minor units', () => {
    const m = fromMinorUnits(1099, 'EUR');
    expect(m.getAmount()).toBe(1099);
    expect(m.getCurrency()).toBe('EUR');
  });

  it('rounds a fractional minor unit rather than truncating', () => {
    expect(fromMinorUnits(1099.6, 'EUR').getAmount()).toBe(1100);
  });
});

describe('fromDecimal', () => {
  it('converts a decimal price to minor units', () => {
    const m = fromDecimal(49.99, 'EUR');
    expect(m.getAmount()).toBe(4999);
    expect(m.getCurrency()).toBe('EUR');
  });

  it('handles a whole-number decimal', () => {
    expect(fromDecimal(89, 'EUR').getAmount()).toBe(8900);
  });

  it('rounds a price carrying more precision than the currency has', () => {
    expect(fromDecimal(8.115, 'EUR').getAmount()).toBe(812);
  });

  it('scales by the currency, not by a fixed hundred', () => {
    expect(fromDecimal(1200, 'JPY').getAmount()).toBe(1200);
    expect(fromDecimal(1.2345, 'BHD').getAmount()).toBe(1235);
  });
});
