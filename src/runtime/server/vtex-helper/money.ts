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
