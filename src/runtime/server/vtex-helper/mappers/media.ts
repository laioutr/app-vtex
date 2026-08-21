import type { VtexImage } from './product';
import type { Media, MediaImage } from '@laioutr-core/core-types/common';

const SIZED_ID_SEGMENT = /(\/arquivos\/ids\/\d+)-\d+-\d+/;

/**
 * Strips the dimensions VTEX bakes into the id segment. Which endpoints return a sized url varies —
 * an orderForm line is always a 55px thumbnail, catalog search is not — and the size that arrives is
 * never the one a storefront wants: the provider recomputes it when asked for one, and serves the
 * stored url untouched when not. No-op on a url that carries none.
 */
export const normalizeImageUrl = (url: string): string => url.replace(SIZED_ID_SEGMENT, '$1');

/**
 * One image, addressed to the `vtex` provider so it can resize on VTEX's own CDN rather than
 * fetching the original and scaling it here.
 */
export const toVtexImage = (src: string, alt?: string): MediaImage => ({
  type: 'image',
  alt: alt || undefined,
  sources: [{ provider: 'vtex', src: normalizeImageUrl(src) }],
});

/** VTEX offers two captions per image and neither is reliably set. */
export const toCatalogImage = (image: VtexImage): MediaImage =>
  toVtexImage(image.imageUrl, image.imageText || image.imageLabel || undefined);

export const toCatalogImages = (images: VtexImage[]): { images: MediaImage[]; media: Media[] } => {
  const mapped = images.map(toCatalogImage);
  return { images: mapped, media: mapped as Media[] };
};
