import { describe, expect, it, vi } from 'vitest';
import { createLegacySearchProvider } from './legacy';
import type { VtexClient } from '../client/types';

const client = (raw: ReturnType<typeof vi.fn>, pub = vi.fn()) =>
  ({ publicFetchRaw: raw, publicFetch: pub }) as unknown as VtexClient;

const withResources = (data: unknown, resources: string) =>
  vi.fn().mockResolvedValue({ data, headers: new Headers({ resources }) });

describe('createLegacySearchProvider', () => {
  it('reads the total from the resources header, not the body', async () => {
    const raw = withResources([{ productId: '1' }, { productId: '2' }], 'items 0-1/42');
    const provider = createLegacySearchProvider(client(raw));
    await expect(
      provider.searchProducts({ from: 0, to: 1, salesChannel: '1', term: 'sneaker' })
    ).resolves.toEqual({ productIds: ['1', '2'], total: 42 });
  });

  it('falls back to the result count when the header is missing', async () => {
    const raw = vi.fn().mockResolvedValue({ data: [{ productId: '1' }], headers: new Headers() });
    const provider = createLegacySearchProvider(client(raw));
    await expect(provider.searchProducts({ from: 0, to: 9, salesChannel: '1' })).resolves.toEqual({
      productIds: ['1'],
      total: 1,
    });
  });

  it('searches by full text with ft', async () => {
    const raw = withResources([], 'items 0-0/0');
    await createLegacySearchProvider(client(raw)).searchProducts({
      term: 'sneaker',
      from: 0,
      to: 9,
      salesChannel: '1',
    });
    const path = raw.mock.calls[0][1] as string;
    expect(path).toContain('ft=sneaker');
    expect(path).toContain('_from=0');
    expect(path).toContain('_to=9');
    expect(path).toContain('sc=1');
  });

  it('filters by category path with fq=C:, which is how a PLP lists', async () => {
    const raw = withResources([], 'items 0-0/0');
    await createLegacySearchProvider(client(raw)).searchProducts({
      categoryPath: '2/3',
      from: 0,
      to: 9,
      salesChannel: '1',
    });
    expect(raw.mock.calls[0][1]).toContain('fq=C%3A2%2F3');
  });

  it('maps legacy facet groups onto AvailableFilter', async () => {
    const pub = vi.fn().mockResolvedValue({
      Departments: [{ Name: 'Damen', Quantity: 3, Link: '/damen' }],
      Brands: [{ Name: 'FILA', Quantity: 2, Link: '/fila' }],
      PriceRanges: [{ Name: 'de 0 a 50', Quantity: 1, Link: '/p/0-50' }],
      CategoriesTrees: [],
    });
    const provider = createLegacySearchProvider(client(vi.fn(), pub));
    const filters = await provider.facets({ term: 'sneaker', salesChannel: '1' });

    expect(filters.map((f) => f.id)).toEqual(['department', 'brand', 'priceRange']);
    expect(filters[1]).toMatchObject({
      type: 'list',
      presentation: 'text',
      wellKnownName: 'brand',
      values: [{ id: 'FILA', label: 'FILA', count: 2 }],
    });
    // An empty group contributes no filter rather than an empty one the storefront must skip.
    expect(filters.some((f) => f.id === 'category')).toBe(false);
  });

  it('requires the map parameter, whose absence is a 400 from VTEX', async () => {
    const pub = vi.fn().mockResolvedValue({});
    await createLegacySearchProvider(client(vi.fn(), pub)).facets({ term: 'x', salesChannel: '1' });
    expect(pub.mock.calls[0][1]).toContain('map=ft');
  });

  it('has no suggestions capability', () => {
    expect(createLegacySearchProvider(client(vi.fn())).suggestions).toBeUndefined();
  });
});
