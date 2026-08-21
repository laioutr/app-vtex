import { Money } from '@screeny05/ts-money';

/**
 * Checkout returns every monetary value in minor units already — `1099` is EUR 10.99.
 */
export const fromMinorUnits = (amount: number, currency: string): Money =>
  new Money(Math.round(amount), currency);

/**
 * Legacy Search and the Pricing API return decimals. The rounder is required: without one
 * `fromDecimal` throws on any value carrying more precision than the currency defines, and VTEX
 * hands back unrounded results of its own price calculations.
 */
export const fromDecimal = (amount: number, currency: string): Money =>
  Money.fromDecimal(amount, currency, Math.round);

/**
 * The cart's currency comes from VTEX rather than from configuration, and ts-money throws on a code
 * it does not know. Unguarded, one unexpected code would take the whole cart down instead of the
 * money on it, so the caller drops the affected component and keeps the rest.
 */
export const tryFromMinorUnits = (amount: number, currency: string): Money | undefined => {
  if (!Number.isFinite(amount)) {
    console.warn(`[app-vtex] no usable amount for a ${currency} value; dropping it`);
    return undefined;
  }

  try {
    return fromMinorUnits(amount, currency);
  } catch {
    console.warn(`[app-vtex] VTEX reported the unknown currency ${currency}; dropping its money`);
    return undefined;
  }
};
