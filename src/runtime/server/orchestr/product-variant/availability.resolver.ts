import { ProductVariantAvailability } from '@laioutr-core/canonical-types/entity/product-variant';
import { defineVtexComponentResolver } from '../../middleware/defineVtex';
import { loadVariants } from '../../vtex-helper/loadVariants';
import { toVariantAvailability } from '../../vtex-helper/mappers/productVariant';

export default defineVtexComponentResolver({
  label: 'VTEX Product Variant Availability Connector',
  entityType: 'ProductVariant',
  // Stock moves faster than anything else a variant carries, so it resolves on its own: sharing a
  // resolver with the stable components would force them to be re-read at the pace of this one.
  provides: [ProductVariantAvailability],
  resolve: async ({ entityIds, context, passthrough, $entity }) => {
    const variants = await loadVariants(context.vtexClient, passthrough, entityIds);

    const entities = entityIds.flatMap((id) => {
      const hit = variants.get(id);
      if (!hit) return [];

      return [$entity({ id, availability: () => toVariantAvailability(hit.item) })];
    });

    return { entities };
  },
  cache: {
    // The runner's client-env prefix carries no market, so two markets sharing a language and
    // currency would otherwise share entries despite resolving different sales channels.
    getKeySuffix: (clientEnv) => clientEnv.market.slug,
    // A minute bounds what this adds on top of the lag the search index already carries.
    ttl: '1 minute',
  },
});
