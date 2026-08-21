import { describe, expect, it } from 'vitest';
import {
  categoryIdFromBreadcrumbId,
  categoryIdsFromPath,
  productIdFromBreadcrumbId,
  toCategoryBreadcrumbId,
  toProductBreadcrumbId,
} from './breadcrumbItems';

describe('breadcrumb item ids', () => {
  it('round-trips a category id', () => {
    expect(categoryIdFromBreadcrumbId(toCategoryBreadcrumbId(4))).toBe(4);
  });

  it('round-trips a product id', () => {
    expect(productIdFromBreadcrumbId(toProductBreadcrumbId('285'))).toBe('285');
  });

  it('keeps the two sources apart', () => {
    expect(categoryIdFromBreadcrumbId(toProductBreadcrumbId('285'))).toBeUndefined();
    expect(productIdFromBreadcrumbId(toCategoryBreadcrumbId(4))).toBeUndefined();
  });

  it('ignores a category id that is not a number', () => {
    expect(categoryIdFromBreadcrumbId('category:abc')).toBeUndefined();
  });
});

describe('categoryIdsFromPath', () => {
  it('reads the trail off a VTEX category id path', () => {
    expect(categoryIdsFromPath('/1/2/3/4/')).toEqual([1, 2, 3, 4]);
  });

  it('yields nothing for an empty path', () => {
    expect(categoryIdsFromPath('')).toEqual([]);
  });
});
