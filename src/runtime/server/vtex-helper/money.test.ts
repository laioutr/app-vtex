import { describe, expect, it, vi } from 'vitest';
import { fromDecimal, fromMinorUnits, tryFromMinorUnits } from './money';

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

describe('tryFromMinorUnits', () => {
  it('behaves like fromMinorUnits for a currency ts-money knows', () => {
    expect(tryFromMinorUnits(4999, 'EUR')?.getAmount()).toBe(4999);
  });

  it('returns undefined instead of throwing on a currency VTEX made up', () => {
    expect(tryFromMinorUnits(4999, 'XYZ')).toBeUndefined();
  });

  it('returns undefined for an absent amount rather than minting NaN cents', () => {
    expect(tryFromMinorUnits(Number.NaN, 'EUR')).toBeUndefined();
    expect(tryFromMinorUnits(Number.POSITIVE_INFINITY, 'EUR')).toBeUndefined();
  });

  it('warns when it degrades, naming what it dropped', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    tryFromMinorUnits(4999, 'XYZ');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('XYZ'));
    warn.mockRestore();
  });
});
