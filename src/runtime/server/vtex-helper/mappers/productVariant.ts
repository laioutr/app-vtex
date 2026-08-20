import type { VtexItem } from './product';
import type { MediaImage } from '@laioutr-core/core-types/common';
import { fromDecimal } from '../money';

const toMediaImage = (item: VtexItem): MediaImage | undefined => {
  const image = item.images?.[0];
  if (!image) return undefined;

  return {
    type: 'image',
    alt: image.imageText || image.imageLabel || undefined,
    sources: [{ provider: 'vtex', src: image.imageUrl }],
  };
};

/** VTEX names the axes in `variations` and parks their values under matching keys on the item. */
const toSelectedOptions = (item: VtexItem) =>
  (item.variations ?? []).flatMap((name) => {
    const values = item[name];
    if (!Array.isArray(values) || values.length === 0) return [];
    return [{ name, value: String(values[0]) }];
  });

/** One function per component, so a resolver computes only the slice that was requested. */
export const toVariantBase = (item: VtexItem) => ({
  sku: item.itemId,
  name: item.name,
  // VTEX returns an empty string for an unset EAN, which is not a GTIN.
  ...(item.ean ? { gtin: item.ean } : {}),
});

export const toVariantInfo = (item: VtexItem) => {
  const image = toMediaImage(item);
  return image ? { image } : {};
};

export const toVariantOptions = (item: VtexItem) => {
  const image = toMediaImage(item);

  return {
    selected: toSelectedOptions(item),
    ...(image ? { image } : {}),
  };
};

export const toVariantAvailability = (item: VtexItem) => {
  const quantity = item.sellers?.[0]?.commertialOffer?.AvailableQuantity ?? 0;
  return { status: quantity > 0 ? ('inStock' as const) : ('outOfStock' as const), quantity };
};

export const toVariantPrices = (item: VtexItem, currency: string) => {
  const offer = item.sellers?.[0]?.commertialOffer;
  if (!offer) return undefined;

  const price = fromDecimal(offer.Price, currency);
  const listPrice =
    typeof offer.ListPrice === 'number' && offer.ListPrice > offer.Price
      ? fromDecimal(offer.ListPrice, currency)
      : undefined;

  return {
    price,
    ...(listPrice ? { strikethroughPrice: listPrice } : {}),
    isOnSale: Boolean(listPrice),
    ...(listPrice
      ? {
          savingsPercent: Math.round(
            ((listPrice.getAmount() - price.getAmount()) / listPrice.getAmount()) * 100
          ),
        }
      : {}),
  };
};

/** Every component at once. Convenient for a suite; a resolver should reach for the parts. */
export const toVariantComponents = (item: VtexItem, currency: string) => ({
  base: toVariantBase(item),
  info: toVariantInfo(item),
  options: toVariantOptions(item),
  availability: toVariantAvailability(item),
  prices: toVariantPrices(item, currency),
});
