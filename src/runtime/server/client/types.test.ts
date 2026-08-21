import { describe, expect, it } from 'vitest';
import { resolveHost, VtexApiError } from './types';

const o = { accountName: 'laioutrpartner', environment: 'vtexcommercestable' };

describe('resolveHost', () => {
  it('puts Pricing on api.vtex.com, which is a different host from everything else', () => {
    expect(resolveHost('pricing', o)).toBe('https://api.vtex.com/laioutrpartner');
  });

  it.each([
    'catalog',
    'catalogSystem',
    'checkout',
    'logistics',
    'vtexid',
    'portal',
    'reviews',
  ] as const)('puts %s on the account domain', (api) => {
    expect(resolveHost(api, o)).toBe('https://laioutrpartner.vtexcommercestable.com.br');
  });

  it('honours the myvtex environment', () => {
    expect(resolveHost('catalog', { ...o, environment: 'myvtex' })).toBe(
      'https://laioutrpartner.myvtex.com.br'
    );
  });
});

describe('VtexApiError', () => {
  it('carries enough context to identify the failing call', () => {
    const err = new VtexApiError(404, 'catalog', '/api/catalog/pvt/product/1', { message: 'nope' });
    expect(err.status).toBe(404);
    expect(err.api).toBe('catalog');
    expect(err.path).toBe('/api/catalog/pvt/product/1');
    expect(err.body).toEqual({ message: 'nope' });
    expect(err.message).toContain('404');
    expect(err.message).toContain('/api/catalog/pvt/product/1');
  });
});
