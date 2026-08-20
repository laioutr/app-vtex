import {
  ProductBase,
  ProductBrand,
  ProductDescription,
  ProductMedia,
  ProductSeo,
  ProductSpecifications,
} from '@laioutr-core/canonical-types/entity/product';
import { defineVtexComponentResolver } from '../../middleware/defineVtex';
import { loadProducts } from '../../vtex-helper/loadProducts';
import {
  toProductBase,
  toProductBrand,
  toProductDescription,
  toProductMedia,
  toProductSeo,
  toProductSpecifications,
} from '../../vtex-helper/mappers/product';

export default defineVtexComponentResolver({
  label: 'VTEX Product Connector',
  entityType: 'Product',
  // Every component here is fillable from any product. `info` and `prices` carry required fields
  // that a product without an image or an offer cannot supply, so they resolve separately.
  provides: [
    ProductBase,
    ProductDescription,
    ProductMedia,
    ProductSeo,
    ProductBrand,
    ProductSpecifications,
  ],
  resolve: async ({ entityIds, context, passthrough, $entity }) => {
    const products = await loadProducts(context.vtexClient, passthrough, entityIds);

    const entities = entityIds.flatMap((id) => {
      const product = products.find((p) => p.productId === id);
      if (!product) return [];

      // Each thunk maps its own slice, and Orchestr calls only the ones it was asked for.
      return [
        $entity({
          id,
          base: () => toProductBase(product),
          description: () => toProductDescription(product),
          media: () => toProductMedia(product),
          seo: () => toProductSeo(product),
          brand: () => toProductBrand(product),
          specifications: () => toProductSpecifications(product),
        }),
      ];
    });

    return { entities };
  },
  cache: {
    // The runner's client-env prefix carries no market, so two markets sharing a language and
    // currency would otherwise share entries despite resolving different sales channels.
    getKeySuffix: (clientEnv) => clientEnv.market.slug,
    // Catalog copy and media change on an editorial rhythm, not a transactional one.
    ttl: '10 minutes',
  },
});
