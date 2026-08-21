import type { VtexImage } from './product';
import type { Media, MediaImage } from '@laioutr-core/core-types/common';

/**
 * One image, addressed to the `vtex` provider so it can resize on VTEX's own CDN rather than
 * fetching the original and scaling it here.
 */
export const toVtexImage = (src: string, alt?: string): MediaImage => ({
  type: 'image',
  alt: alt || undefined,
  sources: [{ provider: 'vtex', src }],
});

/** VTEX offers two captions per image and neither is reliably set. */
export const toCatalogImage = (image: VtexImage): MediaImage =>
  toVtexImage(image.imageUrl, image.imageText || image.imageLabel || undefined);

export const toCatalogImages = (images: VtexImage[]): { images: MediaImage[]; media: Media[] } => {
  const mapped = images.map(toCatalogImage);
  return { images: mapped, media: mapped as Media[] };
};
