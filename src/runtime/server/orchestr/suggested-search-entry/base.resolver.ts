import { SuggestedSearchEntryBase } from '@laioutr-core/canonical-types/entity/suggested-search-entry';
import { defineVtexComponentResolver } from '../../middleware/defineVtex';
import { findById, loadCategoryTree, slugFromUrl } from '../../vtex-helper/categoryTree';
import { loadProducts } from '../../vtex-helper/loadProducts';
import { parseSuggestionId } from '../../vtex-helper/suggestedSearch';

export default defineVtexComponentResolver({
  label: 'VTEX Suggested Search Entry Connector',
  entityType: 'SuggestedSearchEntry',
  provides: [SuggestedSearchEntryBase],
  resolve: async ({ entityIds, context, passthrough, $entity }) => {
    const parsed = entityIds
      .map((id) => ({ id, parts: parseSuggestionId(id) }))
      .filter((e): e is { id: string; parts: { kind: 'product' | 'category'; value: string } } =>
        Boolean(e.parts)
      );

    const productIds = parsed.filter((e) => e.parts.kind === 'product').map((e) => e.parts.value);
    const wantsCategory = parsed.some((e) => e.parts.kind === 'category');

    // Each source is read only when this request actually asks for one of its suggestions.
    const [products, tree] = await Promise.all([
      productIds.length ? loadProducts(context.vtexClient, passthrough, productIds) : [],
      wantsCategory ? loadCategoryTree(context.vtexClient) : [],
    ]);

    const productEntities = parsed
      .filter((e) => e.parts.kind === 'product')
      .flatMap(({ id, parts }) => {
        const product = products.find((p) => p.productId === parts.value);
        if (!product) return [];

        const image = product.items[0]?.images?.[0];

        return [
          $entity({
            id,
            base: () => ({
              type: 'product' as const,
              title: product.productName,
              link: {
                type: 'reference' as const,
                reference: {
                  type: 'Product' as const,
                  slug: product.linkText,
                  id: product.productId,
                },
              },
              ...(image
                ? {
                    cover: {
                      type: 'image' as const,
                      alt: image.imageText || image.imageLabel || undefined,
                      sources: [{ provider: 'vtex', src: image.imageUrl }],
                    },
                  }
                : {}),
            }),
          }),
        ];
      });

    const categoryEntities = parsed
      .filter((e) => e.parts.kind === 'category')
      .flatMap(({ id, parts }) => {
        const node = findById(tree, Number(parts.value));
        if (!node) return [];

        return [
          $entity({
            id,
            base: () => ({
              type: 'category' as const,
              title: node.name,
              link: {
                type: 'reference' as const,
                reference: {
                  type: 'Category' as const,
                  slug: slugFromUrl(node.url),
                  id: String(node.id),
                },
              },
            }),
          }),
        ];
      });

    const entities = [...categoryEntities, ...productEntities];

    return { entities };
  },
});
