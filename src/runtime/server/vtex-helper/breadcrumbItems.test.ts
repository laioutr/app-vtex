import { describe, expect, it } from 'vitest';
import { categoryIdFromBreadcrumbId, toCategoryBreadcrumbId } from './breadcrumbItems';

describe('breadcrumb item ids', () => {
  it('round-trips a category id', () => {
    expect(categoryIdFromBreadcrumbId(toCategoryBreadcrumbId(4))).toBe(4);
  });

  it('ignores an id belonging to another breadcrumb source', () => {
    expect(categoryIdFromBreadcrumbId('product:4')).toBeUndefined();
  });

  it('ignores a category id that is not a number', () => {
    expect(categoryIdFromBreadcrumbId('category:abc')).toBeUndefined();
  });
});
