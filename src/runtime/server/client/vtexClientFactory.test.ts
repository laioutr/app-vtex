import { describe, expect, it, vi } from 'vitest';
import { createVtexClient } from './vtexClientFactory';
import { VtexApiError } from './types';
import { authCookieName } from './cookies';

const ACCOUNT = 'laioutrpartner';

const ok = (body: unknown = { ok: true }) =>
  vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => body,
    headers: { getSetCookie: () => [] },
  });

const deps = (fetchImpl: ReturnType<typeof vi.fn>, cookies: Record<string, string> = {}) => ({
  accountName: ACCOUNT,
  environment: 'vtexcommercestable',
  appKey: 'KEY',
  appToken: 'TOKEN',
  salesChannel: '1',
  cookies,
  onSetCookie: vi.fn(),
  fetchImpl: fetchImpl as unknown as typeof fetch,
});

describe('createVtexClient', () => {
  it('makes no network call while being constructed', () => {
    const f = ok();
    createVtexClient(deps(f));
    expect(f).not.toHaveBeenCalled();
  });

  it('publicFetch forwards VTEX cookies and sends no app credentials', async () => {
    const f = ok();
    const client = createVtexClient(
      deps(f, { vtex_session: 's1', [authCookieName(ACCOUNT)]: 'a1' })
    );
    await client.publicFetch('catalogSystem', '/api/catalog_system/pub/category/tree/3');

    const [url, init] = f.mock.calls[0];
    expect(url).toBe(
      'https://laioutrpartner.vtexcommercestable.com.br/api/catalog_system/pub/category/tree/3'
    );
    expect(init.headers.Cookie).toContain('vtex_session=s1');
    expect(init.headers['X-VTEX-API-AppKey']).toBeUndefined();
    expect(init.headers['X-VTEX-API-AppToken']).toBeUndefined();
  });

  it('adminFetch sends app credentials and deliberately forwards no shopper cookie', async () => {
    const f = ok();
    const client = createVtexClient(
      deps(f, { vtex_session: 's1', [authCookieName(ACCOUNT)]: 'a1' })
    );
    await client.adminFetch('pricing', '/pricing/prices/1');

    const [url, init] = f.mock.calls[0];
    expect(url).toBe('https://api.vtex.com/laioutrpartner/pricing/prices/1');
    expect(init.headers['X-VTEX-API-AppKey']).toBe('KEY');
    expect(init.headers['X-VTEX-API-AppToken']).toBe('TOKEN');
    // A server-to-server call carrying a shopper identity would resolve a different context.
    expect(init.headers.Cookie).toBeUndefined();
  });

  it('propagates upstream Set-Cookie so the VTEX session survives', async () => {
    const f = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
      headers: { getSetCookie: () => ['vtex_segment=g2; Path=/'] },
    });
    const onSetCookie = vi.fn();
    const client = createVtexClient({ ...deps(f), onSetCookie });
    await client.publicFetch('checkout', '/api/checkout/pub/orderForm');
    expect(onSetCookie).toHaveBeenCalledWith('vtex_segment=g2; Path=/');
  });

  it('throws VtexApiError carrying the status, api and path', async () => {
    const f = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ message: 'not found' }),
      headers: { getSetCookie: () => [] },
    });
    const client = createVtexClient(deps(f));
    await expect(client.publicFetch('catalog', '/api/catalog/pvt/product/999')).rejects.toMatchObject(
      { status: 404, api: 'catalog', path: '/api/catalog/pvt/product/999' }
    );
    await expect(
      client.publicFetch('catalog', '/api/catalog/pvt/product/999')
    ).rejects.toBeInstanceOf(VtexApiError);
  });

  it("exposes isAuthenticated from the account's auth cookie", () => {
    expect(
      createVtexClient(deps(ok(), { [authCookieName(ACCOUNT)]: 'a1' })).isAuthenticated
    ).toBe(true);
    expect(createVtexClient(deps(ok(), { VtexIdclientAutCookie_other: 'a1' })).isAuthenticated).toBe(
      false
    );
  });
});
