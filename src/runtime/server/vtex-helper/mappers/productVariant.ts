import type { VtexItem } from './product';
import type { MediaImage } from '@laioutr-core/core-types/common';
import { fromDecimal } from '../money';

const toMediaImage = (item: VtexItem): MediaImage | undefined => {
  const image = item.images?.[0];
  if (!image) return undefined;

  return {
    type: 'image',
    alt: image.imageText || image.imageLabel || undefined,
    sources: [{ provider: 'raw', src: image.imageUrl }],
  };
};

/** VTEX names the axes in `variations` and parks their values under matching keys on the item. */
const toSelectedOptions = (item: VtexItem) =>
  (item.variations ?? []).flatMap((name) => {
    const values = item[name];
    if (!Array.isArray(values) || values.length === 0) return [];
    return [{ name, value: String(values[0]) }];
  });

export const toVariantComponents = (item: VtexItem, currency: string) => {
  const offer = item.sellers?.[0]?.commertialOffer;
  const image = toMediaImage(item);
  const quantity = offer?.AvailableQuantity ?? 0;

  const price = offer ? fromDecimal(offer.Price, currency) : undefined;
  const listPrice =
    offer && typeof offer.ListPrice === 'number' && offer.ListPrice > offer.Price
      ? fromDecimal(offer.ListPrice, currency)
      : undefined;

  return {
    base: {
      sku: item.itemId,
      name: item.name,
      // VTEX returns an empty string for an unset EAN, which is not a GTIN.
      ...(item.ean ? { gtin: item.ean } : {}),
    },
    info: image ? { image } : {},
    options: {
      selected: toSelectedOptions(item),
      ...(image ? { image } : {}),
    },
    availability: {
      status: quantity > 0 ? ('inStock' as const) : ('outOfStock' as const),
      quantity,
    },
    prices:
      price ?
        {
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
        }
      : undefined,
  };
};
