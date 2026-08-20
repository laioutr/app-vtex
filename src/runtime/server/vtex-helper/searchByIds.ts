import type { VtexClient } from '../client/types';
import type { VtexProduct } from './mappers/product';

/**
 * VTEX rejects a window wider than 50 rows, counting both ends — `_from=10&_to=60` is refused
 * while `_from=10&_to=59` is fine, so the limit is the span and not `_to` itself despite what the
 * error says. Omitting the window entirely is worse than exceeding it: the response is then capped
 * at ten rows with a 200, which reads as "these are all the products there are".
 */
const MAX_WINDOW = 50;

const chunk = <T>(items: T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) =>
    items.slice(i * size, i * size + size)
  );

/**
 * Looks products up by id. `skuId` returns each SKU's whole parent product, so the result can be
 * shorter than the id list; the window is sized from the ids, which is an upper bound either way.
 */
export const searchByIds = async (
  client: VtexClient,
  field: 'productId' | 'skuId',
  ids: string[]
): Promise<VtexProduct[]> => {
  const pages = await Promise.all(
    chunk(ids, MAX_WINDOW).map((batch) => {
      const params = new URLSearchParams([
        ...batch.map((id) => ['fq', `${field}:${id}`] as [string, string]),
        ['sc', client.salesChannel],
        ['_from', '0'],
        ['_to', String(batch.length - 1)],
      ]);

      return client.publicFetch<VtexProduct[]>(
        'catalogSystem',
        `/api/catalog_system/pub/products/search?${params}`
      );
    })
  );

  return pages.flat();
};
