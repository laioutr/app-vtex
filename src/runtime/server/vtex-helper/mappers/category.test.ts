import { describe, expect, it } from 'vitest';
import { toCategoryComponents } from './category';
import type { VtexCategoryNode } from '../categoryTree';

const node: VtexCategoryNode = {
  id: 4,
  name: 'Flache Pantoletten',
  url: 'https://shop.example/damen/schuhe/pantoletten/flache-pantoletten',
  children: [],
  hasChildren: false,
  Title: 'Flache Pantoletten kaufen',
  MetaTagDescription: 'Flache Pantoletten im Sortiment.',
};

describe('toCategoryComponents', () => {
  it('maps the display name and the full-path slug', () => {
    expect(toCategoryComponents(node).base).toEqual({
      title: 'Flache Pantoletten',
      slug: 'damen/schuhe/pantoletten/flache-pantoletten',
    });
  });

  it('prefers the VTEX page title for SEO', () => {
    expect(toCategoryComponents(node).seo).toEqual({
      title: 'Flache Pantoletten kaufen',
      description: 'Flache Pantoletten im Sortiment.',
    });
  });

  it('falls back to the category name when VTEX supplies no page title', () => {
    // Root categories come back with Title null.
    expect(toCategoryComponents({ ...node, Title: null }).seo.title).toBe('Flache Pantoletten');
  });

  it('omits an empty meta description rather than emitting a blank one', () => {
    expect(toCategoryComponents({ ...node, MetaTagDescription: '' }).seo).not.toHaveProperty(
      'description'
    );
  });
});
