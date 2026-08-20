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
import { toProductComponents } from '../../vtex-helper/mappers/product';

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
  resolve: async ({ entityIds, context, clientEnv, passthrough, $entity }) => {
    const products = await loadProducts(context.vtexClient, passthrough, entityIds);
    const currency = clientEnv.market.currency;

    const entities = entityIds.flatMap((id) => {
      const product = products.find((p) => p.productId === id);
      if (!product) return [];

      const mapped = toProductComponents(product, currency);

      return [
        $entity({
          id,
          base: () => mapped.base,
          description: () => mapped.description,
          media: () => mapped.media,
          seo: () => mapped.seo,
          brand: () => mapped.brand,
          specifications: () => mapped.specifications,
        }),
      ];
    });

    return { entities };
  },
  cache: {
    // Catalog copy and media change on an editorial rhythm, not a transactional one.
    ttl: '10 minutes',
  },
});
