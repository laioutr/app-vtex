import type { AvailableFilter } from '@laioutr-core/orchestr/types';

export interface SearchProductsInput {
  term?: string;
  /** VTEX category id path, slash-separated with no leading or trailing slash: '2/3'. */
  categoryPath?: string;
  from: number;
  to: number;
  salesChannel: string;
}

export interface SuggestionResult {
  terms: string[];
}

export interface SearchProvider {
  readonly id: 'legacy' | 'intelligent';

  /** Returns ids and a total; hydration belongs to the resolver. */
  searchProducts(input: SearchProductsInput): Promise<{ productIds: string[]; total: number }>;

  facets(input: {
    term?: string;
    categoryId?: string;
    salesChannel: string;
  }): Promise<AvailableFilter[]>;

  /**
   * Optional on purpose: Legacy Search has no autocomplete, so its absence is a type-level fact
   * and the suggestion handler is simply not registered rather than failing at request time.
   */
  suggestions?(input: { term: string }): Promise<SuggestionResult>;
}
