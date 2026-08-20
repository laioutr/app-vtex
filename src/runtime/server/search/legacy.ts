import type { AvailableFilter, WellKnownFilterName } from '@laioutr-core/orchestr/types';
import type { VtexClient } from '../client/types';
import type { SearchProvider } from './types';

interface LegacyProduct {
  productId: string;
}
interface LegacyFacetValue {
  Name: string;
  Quantity: number;
}
interface LegacyFacets {
  Departments?: LegacyFacetValue[];
  Brands?: LegacyFacetValue[];
  PriceRanges?: LegacyFacetValue[];
  CategoriesTrees?: LegacyFacetValue[];
}

/** `items 0-8/42` -> 42. */
const totalFromResources = (headers: Headers, fallback: number): number => {
  const match = /\/(\d+)\s*$/.exec(headers.get('resources') ?? '');
  return match ? Number(match[1]) : fallback;
};

const toFilter = (
  id: string,
  label: string,
  wellKnownName: WellKnownFilterName | undefined,
  values?: LegacyFacetValue[]
): AvailableFilter[] =>
  values?.length
    ? [
        {
          id,
          label,
          ...(wellKnownName ? { wellKnownName } : {}),
          type: 'list',
          presentation: 'text',
          values: values.map((v) => ({ id: v.Name, label: v.Name, count: v.Quantity })),
        },
      ]
    : [];

export const createLegacySearchProvider = (client: VtexClient): SearchProvider => ({
  id: 'legacy',

  async searchProducts({ term, categoryPath, from, to, salesChannel }) {
    const params = new URLSearchParams({ _from: String(from), _to: String(to), sc: salesChannel });
    if (term) params.set('ft', term);
    // `fq=skuId:` silently returns nothing; category filtering uses the C: path form.
    if (categoryPath) params.append('fq', `C:${categoryPath}`);

    const { data, headers } = await client.publicFetchRaw<LegacyProduct[]>(
      'catalogSystem',
      `/api/catalog_system/pub/products/search?${params}`
    );

    return {
      productIds: data.map((p) => p.productId),
      total: totalFromResources(headers, data.length),
    };
  },

  async facets({ term, categoryId, salesChannel }) {
    // `map` is mandatory — omitting it is answered with a 400, not an empty result.
    const path = categoryId
      ? `/api/catalog_system/pub/facets/category/${categoryId}?sc=${salesChannel}`
      : `/api/catalog_system/pub/facets/search/${encodeURIComponent(term ?? '')}?map=ft&sc=${salesChannel}`;

    const raw = await client.publicFetch<LegacyFacets>('catalogSystem', path);

    return [
      ...toFilter('department', 'Department', 'category', raw.Departments),
      ...toFilter('brand', 'Brand', 'brand', raw.Brands),
      ...toFilter('priceRange', 'Price', 'price', raw.PriceRanges),
      ...toFilter('category', 'Category', 'category', raw.CategoriesTrees),
    ];
  },
});
