import { describe, expect, it } from 'vitest';
import { menuNodes, parseMenuItemId, toMenuItemId } from './menuItems';
import type { VtexCategoryNode } from './categoryTree';

const node = (
  id: number,
  name: string,
  url: string,
  children: VtexCategoryNode[] = []
): VtexCategoryNode => ({ id, name, url, children, hasChildren: children.length > 0 });

const tree: VtexCategoryNode[] = [
  node(1, 'Damen', 'https://shop.example/damen', [
    node(2, 'Schuhe', 'https://shop.example/damen/schuhe', [
      node(3, 'Sneaker', 'https://shop.example/damen/schuhe/sneaker'),
    ]),
  ]),
  node(5, 'Herren', 'https://shop.example/herren', [
    node(6, 'Schuhe', 'https://shop.example/herren/schuhe'),
  ]),
];

describe('menu item ids', () => {
  it('round-trips the alias and the category', () => {
    expect(parseMenuItemId(toMenuItemId('main', 5))).toEqual({ alias: 'main', categoryId: 5 });
  });

  it('keeps the same category in two menus apart', () => {
    expect(toMenuItemId('main', 5)).not.toBe(toMenuItemId('herren', 5));
  });

  it('handles an alias containing a colon-free path', () => {
    expect(parseMenuItemId(toMenuItemId('damen/schuhe', 3))).toEqual({
      alias: 'damen/schuhe',
      categoryId: 3,
    });
  });

  it('rejects an id that is not a menu item', () => {
    expect(parseMenuItemId('5')).toBeUndefined();
    expect(parseMenuItemId('main:abc')).toBeUndefined();
  });
});

describe('menuNodes', () => {
  it('spans the whole tree for main', () => {
    expect(menuNodes(tree, 'main').map((n) => n.id)).toEqual([1, 2, 3, 5, 6]);
  });

  it('spans a root category\'s descendants, excluding the root itself', () => {
    expect(menuNodes(tree, 'damen').map((n) => n.id)).toEqual([2, 3]);
  });

  it('is empty for an alias naming no category', () => {
    expect(menuNodes(tree, 'nope')).toEqual([]);
  });
});
