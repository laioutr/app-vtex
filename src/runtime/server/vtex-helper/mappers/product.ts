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
  ean?: string | null;
  images?: VtexImage[];
  sellers?: { commertialOffer: VtexCommertialOffer }[];
  /**
   * Names of the SKU's option axes. Each name is also a key on this item holding its values, so
   * the axes can only be read by looking the names back up.
   */
  variations?: string[] | null;
  [option: string]: unknown;
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
  /** Category display-name paths, deepest first: `['/Damen/Schuhe/', …]`. */
  categories?: string[];
  /** The same trail as ids, deepest first: `['/1/2/3/4/', '/1/2/3/', …]`. */
  categoriesIds?: string[];
  items: VtexItem[];
  /** Specification groups arrive as extra top-level keys naming an array of values. */
  allSpecifications?: string[] | null;
  [specification: string]: unknown;
}

const toMediaImage = (image: VtexImage): MediaImage => ({
  type: 'image',
  alt: image.imageText || image.imageLabel || undefined,
  // VTEX resizes on its own CDN; the provider turns a requested size into the right URL.
  sources: [{ provider: 'vtex', src: image.imageUrl }],
});

const imagesOf = (product: VtexProduct): VtexImage[] =>
  product.items.flatMap((item) => item.images ?? []);

/** One offer per SKU, from the seller the storefront transacts against. */
const offersOf = (product: VtexProduct): VtexCommertialOffer[] =>
  product.items.flatMap((item) => {
    const offer = item.sellers?.[0]?.commertialOffer;
    return offer ? [offer] : [];
  });

const toPrices = (product: VtexProduct, currency: string) => {
  const offers = offersOf(product);
  if (offers.length === 0) return undefined;

  // A product's SKUs can be priced differently, and the cheapest is what a shopper is promised —
  // so it sets the price, and any strikethrough has to be the one belonging to that same SKU.
  const cheapest = offers.reduce((a, b) => (b.Price < a.Price ? b : a));

  const price = fromDecimal(cheapest.Price, currency);
  const listPrice =
    typeof cheapest.ListPrice === 'number' && cheapest.ListPrice > cheapest.Price
      ? fromDecimal(cheapest.ListPrice, currency)
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
    isStartingFrom: offers.some((offer) => offer.Price !== cheapest.Price),
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

/**
 * One function per component rather than one building all of them: Orchestr invokes a component's
 * thunk only when that component was asked for, so a resolver that computes everything up front
 * throws most of the work away on a request that wanted one slice.
 */
export const toProductBase = (product: VtexProduct) => ({
  name: product.productName,
  slug: product.linkText,
});

export const toProductMedia = (product: VtexProduct) => {
  const images = imagesOf(product).map(toMediaImage);
  return { images, media: images as Media[] };
};

export const toProductInfo = (product: VtexProduct) => {
  const cover = imagesOf(product).map(toMediaImage)[0];

  return {
    ...(cover ? { cover } : {}),
    ...(product.brand ? { brand: product.brand } : {}),
  };
};

export const toProductDescription = (product: VtexProduct) => ({
  html: product.description ?? '',
});

export const toProductSeo = (product: VtexProduct) => ({
  title: product.productTitle || product.productName,
  ...(product.metaTagDescription ? { description: product.metaTagDescription } : {}),
});

export const toProductBrand = (product: VtexProduct) =>
  product.brand ? { name: product.brand } : {};

export const toProductPrices = toPrices;

export const toProductSpecifications = toSpecifications;

/** Every component at once. Convenient for a suite; a resolver should reach for the parts. */
export const toProductComponents = (product: VtexProduct, currency: string) => ({
  base: toProductBase(product),
  info: toProductInfo(product),
  description: toProductDescription(product),
  media: toProductMedia(product),
  prices: toProductPrices(product, currency),
  seo: toProductSeo(product),
  brand: toProductBrand(product),
  specifications: toProductSpecifications(product),
});
