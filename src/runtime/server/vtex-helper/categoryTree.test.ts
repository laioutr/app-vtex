import { describe, expect, it } from 'vitest';
import {
  ancestorsOf,
  categoryPathOf,
  findById,
  findBySlug,
  flatten,
  slugFromUrl,
} from './categoryTree';
import type { VtexCategoryNode } from './categoryTree';

const node = (
  id: number,
  name: string,
  url: string,
  children: VtexCategoryNode[] = []
): VtexCategoryNode => ({ id, name, url, children, hasChildren: children.length > 0 });

const tree: VtexCategoryNode[] = [
  node(2, 'Damen', 'https://shop.example/damen', [
    node(3, 'Schuhe', 'https://shop.example/damen/schuhe', [
      node(4, 'Sneaker', 'https://shop.example/damen/schuhe/sneaker'),
    ]),
    node(7, 'Taschen', 'https://shop.example/damen/taschen'),
  ]),
];

describe('slugFromUrl', () => {
  it('takes the whole path, not the last segment', () => {
    expect(slugFromUrl('https://shop.example/damen/schuhe/sneaker')).toBe('damen/schuhe/sneaker');
  });

  it('tolerates a trailing slash', () => {
    expect(slugFromUrl('https://shop.example/damen/')).toBe('damen');
  });

  it('keeps categories that share a name distinct', () => {
    expect(slugFromUrl('https://shop.example/damen/schuhe')).not.toBe(
      slugFromUrl('https://shop.example/herren/schuhe')
    );
  });
});

describe('flatten', () => {
  it('yields every node in the tree', () => {
    expect(
      flatten(tree)
        .map((n) => n.id)
        .sort()
    ).toEqual([2, 3, 4, 7]);
  });
});

describe('findBySlug', () => {
  it('finds a nested category by its full path', () => {
    expect(findBySlug(tree, 'damen/schuhe/sneaker')?.id).toBe(4);
  });

  it('returns undefined for an unknown slug', () => {
    expect(findBySlug(tree, 'nope')).toBeUndefined();
  });
});

describe('ancestorsOf', () => {
  it('returns ancestors root-first, excluding the node', () => {
    expect(ancestorsOf(tree, 4).map((n) => n.id)).toEqual([2, 3]);
  });

  it('returns nothing for a root category', () => {
    expect(ancestorsOf(tree, 2)).toEqual([]);
  });
});

describe('categoryPathOf', () => {
  it('builds the VTEX category path used by fq=C:', () => {
    expect(categoryPathOf(tree, 4)).toBe('2/3/4');
  });

  it('handles a root category', () => {
    expect(categoryPathOf(tree, 2)).toBe('2');
  });

  it('carries no leading or trailing slash, both of which VTEX rejects', () => {
    expect(categoryPathOf(tree, 4)).not.toMatch(/^\/|\/$/);
  });

  it('returns an empty string for an unknown id', () => {
    expect(categoryPathOf(tree, 999)).toBe('');
  });
});

describe('findById', () => {
  it('finds a nested node', () => {
    expect(findById(tree, 7)?.name).toBe('Taschen');
  });
});
