import { toVtexImage } from './media';
import type { VtexOrderForm, VtexOrderFormItem } from '../../types/vtexCheckout';
import type { Link, MediaImage } from '@laioutr-core/core-types/common';
import type { Money } from '@screeny05/ts-money';
import { tryFromMinorUnits } from '../money';

/**
 * The cart reports the currency VTEX actually charged in, which is not necessarily the market's:
 * a sales channel may price elsewhere, and the shopper pays what checkout says.
 */
export const currencyOf = (orderForm: VtexOrderForm): string | undefined =>
  orderForm.storePreferencesData?.currencyCode ?? undefined;

const DETAIL_PATH = /^\/?([^/?#]+)\/p(?:[?#].*)?$/;

export const slugFromDetailUrl = (detailUrl: string | null | undefined): string | undefined =>
  detailUrl ? DETAIL_PATH.exec(detailUrl)?.[1] : undefined;

const totalizerValue = (orderForm: VtexOrderForm, id: string): number | undefined =>
  orderForm.totalizers?.find((totalizer) => totalizer.id === id)?.value;

export const toCartBase = (orderForm: VtexOrderForm, checkoutUrl: string) => ({
  totalQuantity: orderForm.items.reduce((sum, line) => sum + line.quantity, 0),
  checkoutLink: { type: 'url' as const, href: checkoutUrl },
});

export const toCartCost = (orderForm: VtexOrderForm, currency: string) => {
  // Derived from the same numbers VTEX totalled, so the fallback is arithmetic rather than a guess.
  const itemsTotal =
    totalizerValue(orderForm, 'Items') ??
    orderForm.items.reduce((sum, line) => sum + (line.priceDefinition?.total ?? Number.NaN), 0);

  const subtotal = tryFromMinorUnits(itemsTotal, currency);
  const total = tryFromMinorUnits(orderForm.value, currency);
  if (!subtotal || !total) return undefined;

  // Without a shipping address VTEX has nothing to charge carriage on, so the total is provisional.
  const isEstimated = (orderForm.shippingData?.selectedAddresses?.length ?? 0) === 0;

  const shippingValue = totalizerValue(orderForm, 'Shipping');
  const taxValue = totalizerValue(orderForm, 'Tax');
  const shipping =
    shippingValue === undefined ? undefined : tryFromMinorUnits(shippingValue, currency);
  const tax = taxValue === undefined ? undefined : tryFromMinorUnits(taxValue, currency);

  return {
    subtotal,
    subtotalIsEstimated: false,
    total,
    totalIsEstimated: isEstimated,
    shipping: shipping ? { total: shipping, isEstimated } : undefined,
    tax: tax ? { total: tax, isEstimated, isIncluded: false } : undefined,
  };
};

const toProductLink = (line: VtexOrderFormItem): Link | undefined => {
  const slug = slugFromDetailUrl(line.detailUrl);
  if (!slug) {
    console.warn(
      `[app-vtex] cart line ${line.uniqueId} has no usable detail url; omitting its link`
    );
    return undefined;
  }

  return { type: 'reference', reference: { type: 'Product', id: line.productId, slug } };
};

const toCover = (line: VtexOrderFormItem): MediaImage | undefined =>
  line.imageUrl ? toVtexImage(line.imageUrl, line.name) : undefined;

export const toCartItemBase = (line: VtexOrderFormItem) => ({
  type: 'product' as const,
  quantity: line.quantity,
  title: line.name,
  subtitle: line.skuName && line.skuName !== line.name ? line.skuName : undefined,
  brand: line.additionalInfo?.brandName ?? undefined,
  code: line.refId ?? line.ean ?? undefined,
  link: toProductLink(line),
  cover: toCover(line),
});

export const toCartItemCost = (line: VtexOrderFormItem, currency: string) => {
  // `sellingPrice` sits right here and is deliberately unread: VTEX documents it as not
  // rounding-safe and points at `priceDefinition` instead.
  const single = tryFromMinorUnits(
    line.priceDefinition?.calculatedSellingPrice ?? Number.NaN,
    currency
  );
  const total = tryFromMinorUnits(line.priceDefinition?.total ?? Number.NaN, currency);
  const subtotal = tryFromMinorUnits(line.price * line.quantity, currency);
  if (!single || !total || !subtotal) {
    console.warn(`[app-vtex] cart line ${line.uniqueId} carries no usable price; dropping it`);
    return undefined;
  }

  const listPrice =
    typeof line.listPrice === 'number' ? tryFromMinorUnits(line.listPrice, currency) : undefined;
  const strikethrough: Money | undefined = listPrice?.greaterThan(single) ? listPrice : undefined;

  return { single, singleStrikethrough: strikethrough, subtotal, total };
};

export const toCartItemAvailability = (line: VtexOrderFormItem) => ({
  // The orderForm reports a status but no free-stock figure, so the line's own quantity stands in.
  quantity: line.quantity,
  status: line.availability === 'available' ? ('inStock' as const) : ('outOfStock' as const),
});

export const toCartItemQuantityRule = (line: VtexOrderFormItem) => {
  const increment = line.unitMultiplier && line.unitMultiplier > 0 ? line.unitMultiplier : 1;

  // The minimum has to be a multiple of the step, so a six-pack cannot start at one.
  return { min: increment, increment, canChange: true };
};
