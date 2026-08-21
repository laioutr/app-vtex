import { ProductInfo } from '@laioutr-core/canonical-types/entity/product';
import { defineVtexComponentResolver } from '../../middleware/defineVtex';
import { loadProducts } from '../../vtex-helper/loadProducts';
import { toProductInfo } from '../../vtex-helper/mappers/product';

export default defineVtexComponentResolver({
  label: 'VTEX Product Info Connector',
  entityType: 'Product',
  provides: [ProductInfo],
  resolve: async ({ entityIds, context, passthrough, $entity }) => {
    const products = await loadProducts(context.vtexClient, passthrough, entityIds);

    const entities = entityIds.flatMap((id) => {
      const product = products.find((p) => p.productId === id);
      if (!product) return [];

      const info = toProductInfo(product);
      // `cover` is required, so a product with no image contributes no component at all rather
      // than one the storefront has to guard against.
      if (!info.cover) return [];

      return [$entity({ id, info: () => ({ ...info, cover: info.cover! }) })];
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
