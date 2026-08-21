import { describe, expect, it, vi } from 'vitest';
import { searchByIds } from './searchByIds';
import type { VtexClient } from '../client/types';

const client = (publicFetch: ReturnType<typeof vi.fn>) =>
  ({ publicFetch, salesChannel: '1' }) as unknown as VtexClient;

describe('searchByIds', () => {
  it('always sends a window, without which VTEX caps the response at ten rows', async () => {
    const fetch = vi.fn().mockResolvedValue([]);
    await searchByIds(client(fetch), 'productId', ['285', '305']);

    const path = fetch.mock.calls[0][1] as string;
    expect(path).toContain('_from=0');
    // The window is inclusive at both ends, so two ids end at index 1.
    expect(path).toContain('_to=1');
  });

  it('splits at fifty ids, the widest window VTEX accepts', async () => {
    const fetch = vi.fn().mockResolvedValue([]);
    const ids = Array.from({ length: 51 }, (_, i) => String(i));
    await searchByIds(client(fetch), 'productId', ids);

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0][1]).toContain('_to=49');
    expect(fetch.mock.calls[1][1]).toContain('_to=0');
  });

  it('concatenates the chunks into one result', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce([{ productId: 'a' }])
      .mockResolvedValueOnce([{ productId: 'b' }]);
    const ids = Array.from({ length: 51 }, (_, i) => String(i));

    const all = await searchByIds(client(fetch), 'productId', ids);
    expect(all.map((p) => p.productId)).toEqual(['a', 'b']);
  });

  it('looks up by the requested field', async () => {
    const fetch = vi.fn().mockResolvedValue([]);
    await searchByIds(client(fetch), 'skuId', ['1917']);
    expect(fetch.mock.calls[0][1]).toContain('fq=skuId%3A1917');
  });

  it('makes no request for an empty id list', async () => {
    const fetch = vi.fn();
    await expect(searchByIds(client(fetch), 'productId', [])).resolves.toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
});
