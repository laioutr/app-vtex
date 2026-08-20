import { paginate } from '#imports';
import { ProductDetailPage } from '@laioutr-core/canonical-types/ecommerce';
import type { VtexClient } from '../../client/types';
import type { VtexProduct } from '../../vtex-helper/mappers/product';
import { defineVtexPageIndex } from '../../middleware/defineVtex';
import { toProductPageEntry } from '../../vtex-helper/pageIndexEntries';

/** `GetProductAndSkuIds` is the only way to enumerate: an unfiltered search returns nothing. */
const listProductIds = async (client: VtexClient, from: number, to: number) => {
  const res = await client.adminFetch<{ data: Record<string, number[]>; range: { total: number } }>(
    'catalogSystem',
    `/api/catalog_system/pvt/products/GetProductAndSkuIds?_from=${from}&_to=${to}`
  );

  return { ids: Object.keys(res.data ?? {}), total: res.range?.total ?? 0 };
};

const hydrate = async (client: VtexClient, ids: string[]) => {
  if (ids.length === 0) return [];

  const params = new URLSearchParams([
    ...ids.map((id) => ['fq', `productId:${id}`] as [string, string]),
    ['sc', client.salesChannel],
    ['_from', '0'],
    ['_to', String(ids.length - 1)],
  ]);

  return client.publicFetch<VtexProduct[]>(
    'catalogSystem',
    `/api/catalog_system/pub/products/search?${params}`
  );
};

export default defineVtexPageIndex({
  for: ProductDetailPage,
  label: 'VTEX Product',
  batchSize: 50,
  cache: { ttl: '1h', search: { ttl: '5m' }, locate: { ttl: '1 day' } },

  /** Down the same slug path `bySlug.query.ts` takes, so index and page agree on what a URL means. */
  locate: async ({ context, params }) => {
    const found = await context.vtexClient.publicFetch<VtexProduct[]>(
      'catalogSystem',
      `/api/catalog_system/pub/products/search/${encodeURIComponent(params.slug)}/p?sc=${context.vtexSalesChannel}`
    );

    // A miss is an empty list, not a 404.
    const product = found[0];
    if (!product) return undefined;

    const entry = toProductPageEntry(product);
    return { subject: entry.subject, meta: entry.meta };
  },

  count: async ({ context }) => (await listProductIds(context.vtexClient, 1, 1)).total,

  search: async ({ context, term, take }) => {
    const found = await context.vtexClient.publicFetch<VtexProduct[]>(
      'catalogSystem',
      `/api/catalog_system/pub/products/search?ft=${encodeURIComponent(term)}&_from=0&_to=${take - 1}&sc=${context.vtexSalesChannel}`
    );

    return found.map(toProductPageEntry);
  },

  list: ({ context, batchSize, startCursor }) =>
    paginate(async ({ cursor }) => {
      // `GetProductAndSkuIds` is 1-indexed and its range is inclusive on both ends.
      const from = Number(cursor ?? 1);
      const { ids, total } = await listProductIds(context.vtexClient, from, from + batchSize - 1);
      if (ids.length === 0) return { entries: [] };

      const next = from + batchSize;
      return {
        entries: (await hydrate(context.vtexClient, ids)).map(toProductPageEntry),
        nextCursor: next <= total ? String(next) : undefined,
      };
    }, startCursor),
});
