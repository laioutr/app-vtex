import { MenuByAliasQuery } from '@laioutr-core/canonical-types/ecommerce';
import { defineVtexQueryTemplateProvider } from '../../middleware/defineVtex';
import { loadCategoryTree, slugFromUrl } from '../../vtex-helper/categoryTree';

export default defineVtexQueryTemplateProvider({
  for: MenuByAliasQuery,
  run: async ({ context }) => [
    { input: { alias: 'main' }, label: 'Main navigation' },
    // Only root categories: a menu rooted at a leaf has nothing to render.
    ...(await loadCategoryTree(context.vtexClient)).map((node) => ({
      input: { alias: slugFromUrl(node.url) },
      label: node.name,
    })),
  ],
});
