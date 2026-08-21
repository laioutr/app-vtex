import { ProductsByCategorySlugQuery } from '@laioutr-core/canonical-types/ecommerce';
import { defineVtexQueryTemplateProvider } from '../../middleware/defineVtex';
import {
  ancestorsOf,
  flatten,
  loadCategoryTree,
  slugFromUrl,
} from '../../vtex-helper/categoryTree';

export default defineVtexQueryTemplateProvider({
  for: ProductsByCategorySlugQuery,
  run: async ({ context, input }) => {
    const tree = await loadCategoryTree(context.vtexClient);
    const term = input.term?.toLowerCase();

    return flatten(tree)
      .map((node) => ({
        input: { categorySlug: slugFromUrl(node.url) },
        // Category names repeat across the tree, so the trail is what tells two "Sport" apart.
        label: [...ancestorsOf(tree, node.id), node].map((n) => n.name).join(' › '),
      }))
      .filter((template) => !term || template.label.toLowerCase().includes(term));
  },
});
