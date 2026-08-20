import type { Media, MediaImage } from '@laioutr-core/core-types/common';
import { fromDecimal } from '../money';

export interface VtexCommertialOffer {
  Price: number;
  ListPrice: number | null;
  AvailableQuantity: number;
}

export interface VtexImage {
  imageUrl: string;
  imageText?: string | null;
  imageLabel?: string | null;
}

export interface VtexItem {
  itemId: string;
  name: string;
  nameComplete?: string;
  images?: VtexImage[];
  sellers?: { commertialOffer: VtexCommertialOffer }[];
  variations?: Record<string, string[]>;
}

export interface VtexProduct {
  productId: string;
  productName: string;
  linkText: string;
  description?: string | null;
  productTitle?: string | null;
  metaTagDescription?: string | null;
  brand?: string | null;
  brandId?: number | null;
  categoryId?: string | null;
  items: VtexItem[];
  /** Specification groups arrive as extra top-level keys naming an array of values. */
  allSpecifications?: string[] | null;
  [specification: string]: unknown;
}

const toMediaImage = (image: VtexImage): MediaImage => ({
  type: 'image',
  alt: image.imageText || image.imageLabel || undefined,
  // `raw` rather than a named provider: VTEX serves these from its own CDN with no NuxtImage driver.
  sources: [{ provider: 'raw', src: image.imageUrl }],
});

const imagesOf = (product: VtexProduct): VtexImage[] =>
  product.items.flatMap((item) => item.images ?? []);

/** The first seller's offer is the one the storefront transacts against. */
const offerOf = (product: VtexProduct): VtexCommertialOffer | undefined =>
  product.items.flatMap((item) => item.sellers ?? []).map((s) => s.commertialOffer)[0];

const toPrices = (product: VtexProduct, currency: string) => {
  const offer = offerOf(product);
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
    // Every item shares one offer here, so the displayed price is the price, not a floor.
    isStartingFrom: false,
  };
};

/**
 * VTEX returns each specification group as a top-level key whose name is listed in
 * `allSpecifications`, so the rows can only be read by looking the names back up.
 */
const toSpecifications = (product: VtexProduct) => {
  const properties = (product.allSpecifications ?? []).flatMap((name) => {
    const values = product[name];
    if (!Array.isArray(values) || values.length === 0) return [];
    return [{ name, value: values.join(', ') }];
  });

  return properties.length ? { properties } : {};
};

export const toProductComponents = (product: VtexProduct, currency: string) => {
  const images = imagesOf(product).map(toMediaImage);
  const cover = images[0];

  return {
    base: { name: product.productName, slug: product.linkText },
    info: {
      ...(cover ? { cover } : {}),
      ...(product.brand ? { brand: product.brand } : {}),
    },
    description: { html: product.description ?? '' },
    media: { images, media: images as Media[] },
    prices: toPrices(product, currency),
    seo: {
      title: product.productTitle || product.productName,
      ...(product.metaTagDescription ? { description: product.metaTagDescription } : {}),
    },
    brand: product.brand ? { name: product.brand } : {},
    specifications: toSpecifications(product),
  };
};
