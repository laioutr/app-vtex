import type { ProviderGetImage } from '@nuxt/image';

/**
 * VTEX resizes on its own CDN: the id segment of an `/arquivos/ids/` path carries the dimensions,
 * so `…/ids/156952/shoe.jpg` becomes `…/ids/156952-300-300/shoe.jpg`. A dimension of `0` lets VTEX
 * pick it from the other one, which is how a width-only request keeps its aspect ratio.
 */
const ID_SEGMENT = /(\/arquivos\/ids\/)(\d+)(?:-\d+-\d+)?/;

export const getImage: ProviderGetImage = (src, options = {}) => {
  const { width, height } = options.modifiers ?? {};

  // Asking for neither dimension means the original is what was wanted.
  if (!width && !height) return { url: src };

  // Anything not served from VTEX's file store is passed through untouched.
  if (!ID_SEGMENT.test(src)) return { url: src };

  return {
    url: src.replace(ID_SEGMENT, `$1$2-${Math.round(width ?? 0)}-${Math.round(height ?? 0)}`),
  };
};
