import { describe, expect, it, vi } from 'vitest';
import { loadProducts } from './loadProducts';
import type { VtexClient } from '../client/types';
import type { VtexProduct } from './mappers/product';
import { loadedProductsToken } from '../const/passthroughTokens';

const product = (productId: string): VtexProduct => ({
  productId,
  productName: `Product ${productId}`,
  linkText: `product-${productId}`,
  items: [],
});

const store = (initial?: VtexProduct[]) => {
  const values = new Map<unknown, unknown>();
  if (initial) values.set(loadedProductsToken, initial);
  return {
    get: vi.fn((token: unknown) => values.get(token)),
    set: vi.fn((token: unknown, value: unknown) => values.set(token, value)),
  };
};

const client = (publicFetch: ReturnType<typeof vi.fn>) =>
  ({ publicFetch, salesChannel: '1' }) as unknown as VtexClient;

describe('loadProducts', () => {
  it('always sends an explicit window, without which VTEX returns nothing', async () => {
    const fetch = vi.fn().mockResolvedValue([product('285'), product('305')]);
    await loadProducts(client(fetch), store() as never, ['285', '305']);

    const path = fetch.mock.calls[0][1] as string;
    expect(path).toContain('fq=productId%3A285');
    expect(path).toContain('fq=productId%3A305');
    expect(path).toContain('_from=0');
    // `_to` is inclusive, so a two-product batch ends at index 1.
    expect(path).toContain('_to=1');
  });

  it('fetches only what the store is missing', async () => {
    const fetch = vi.fn().mockResolvedValue([product('305')]);
    const passthrough = store([product('285')]);

    const all = await loadProducts(client(fetch), passthrough as never, ['285', '305']);

    expect(fetch.mock.calls[0][1]).not.toContain('285');
    expect(all.map((p) => p.productId).sort()).toEqual(['285', '305']);
  });

  it('makes no request when the store already has every product', async () => {
    const fetch = vi.fn();
    const passthrough = store([product('285')]);

    await expect(loadProducts(client(fetch), passthrough as never, ['285'])).resolves.toHaveLength(
      1
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('folds what it fetched back in, so a later resolver reuses it', async () => {
    const fetch = vi.fn().mockResolvedValue([product('285')]);
    const passthrough = store();

    await loadProducts(client(fetch), passthrough as never, ['285']);

    expect(passthrough.set).toHaveBeenCalledWith(loadedProductsToken, [product('285')]);
  });
});
