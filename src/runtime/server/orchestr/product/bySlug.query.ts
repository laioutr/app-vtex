import { ProductBySlugQuery } from '@laioutr-core/canonical-types/ecommerce';
import type { VtexProduct } from '../../vtex-helper/mappers/product';
import { loadedProductsToken } from '../../const/passthroughTokens';
import { defineVtexQuery } from '../../middleware/defineVtex';

export default defineVtexQuery(ProductBySlugQuery, async ({ context, input, passthrough }) => {
  const found = await context.vtexClient.publicFetch<VtexProduct[]>(
    'catalogSystem',
    `/api/catalog_system/pub/products/search/${encodeURIComponent(input.slug)}/p?sc=${context.vtexSalesChannel}`
  );

  // An unknown slug yields an empty list rather than a 404, so absence is the only signal.
  const product = found[0];
  if (!product) throw new Error(`No product found for slug: ${input.slug}`);

  // The resolvers would otherwise refetch what this query just read.
  passthrough.set(loadedProductsToken, found);

  return { id: product.productId };
});
