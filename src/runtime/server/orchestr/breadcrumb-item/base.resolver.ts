import { BreadcrumbItemBase } from '@laioutr-core/canonical-types/entity/breadcrumb-item';
import { defineVtexComponentResolver } from '../../middleware/defineVtex';
import {
  categoryIdFromBreadcrumbId,
  productIdFromBreadcrumbId,
} from '../../vtex-helper/breadcrumbItems';
import { findById, loadCategoryTree, slugFromUrl } from '../../vtex-helper/categoryTree';
import { loadProducts } from '../../vtex-helper/loadProducts';

export default defineVtexComponentResolver({
  label: 'VTEX Breadcrumb Connector',
  entityType: 'BreadcrumbItem',
  provides: [BreadcrumbItemBase],
  resolve: async ({ entityIds, context, passthrough, $entity }) => {
    const categoryCrumbs = entityIds
      .map((id) => ({ id, categoryId: categoryIdFromBreadcrumbId(id) }))
      .filter((e): e is { id: string; categoryId: number } => e.categoryId !== undefined);

    const productCrumbs = entityIds
      .map((id) => ({ id, productId: productIdFromBreadcrumbId(id) }))
      .filter((e): e is { id: string; productId: string } => e.productId !== undefined);

    // Each source is fetched only when this request actually asks for one of its crumbs.
    const [tree, products] = await Promise.all([
      categoryCrumbs.length ? loadCategoryTree(context.vtexClient) : [],
      productCrumbs.length
        ? loadProducts(
            context.vtexClient,
            passthrough,
            productCrumbs.map((c) => c.productId)
          )
        : [],
    ]);

    const categoryEntities = categoryCrumbs.flatMap(({ id, categoryId }) => {
      const node = findById(tree, categoryId);
      if (!node) return [];

      return [
        $entity({
          id,
          base: () => ({
            name: node.name,
            // A reference rather than an href: the page type owns how a category URL is built.
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

    const productEntities = productCrumbs.flatMap(({ id, productId }) => {
      const product = products.find((p) => p.productId === productId);
      if (!product) return [];

      return [
        $entity({
          id,
          base: () => ({
            name: product.productName,
            link: {
              type: 'reference' as const,
              reference: {
                type: 'Product' as const,
                slug: product.linkText,
                id: product.productId,
              },
            },
            // The product ends its own breadcrumb, so this crumb is always the page being viewed.
            isCurrentPage: true,
          }),
        }),
      ];
    });

    return { entities: [...categoryEntities, ...productEntities] };
  },
  cache: {
    // The runner's client-env prefix carries no market, so two markets sharing a language and
    // currency would otherwise share entries despite resolving different sales channels.
    getKeySuffix: (clientEnv) => clientEnv.market.slug,
    // Matches the category tree's own lifetime, so a cached component cannot outlive the tree it
    // was derived from.
    ttl: '10 minutes',
  },
});
