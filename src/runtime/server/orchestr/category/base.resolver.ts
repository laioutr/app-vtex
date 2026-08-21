import {
  CategoryBase,
  CategoryContent,
  CategoryMedia,
  CategorySeo,
} from '@laioutr-core/canonical-types/entity/category';
import { defineVtexComponentResolver } from '../../middleware/defineVtex';
import { findById, loadCategoryTree } from '../../vtex-helper/categoryTree';
import { loadCategoryDescriptions } from '../../vtex-helper/loadCategoryDescriptions';
import {
  toCategoryBase,
  toCategoryContent,
  toCategoryMedia,
  toCategorySeo,
} from '../../vtex-helper/mappers/category';

export default defineVtexComponentResolver({
  label: 'VTEX Category Connector',
  entityType: 'Category',
  provides: [CategoryBase, CategorySeo, CategoryContent, CategoryMedia],
  resolve: async ({ entityIds, requestedComponents, context, $entity }) => {
    const tree = await loadCategoryTree(context.vtexClient);

    const nodes = entityIds.flatMap((id) => {
      const node = findById(tree, Number(id));
      return node ? [{ id, node }] : [];
    });

    // One admin read per category, so it is worth making only when the content component is asked
    // for — a card grid requests base and media and must not pay for descriptions it never shows.
    const descriptions = requestedComponents.includes('content')
      ? await loadCategoryDescriptions(
          context.vtexClient,
          nodes.map(({ node }) => node.id)
        )
      : new Map<number, string>();

    const entities = nodes.map(({ id, node }) =>
      $entity({
        id,
        base: () => toCategoryBase(node),
        seo: () => toCategorySeo(node),
        content: () => toCategoryContent(descriptions.get(node.id)),
        media: () => toCategoryMedia(),
      })
    );

    return { entities };
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
