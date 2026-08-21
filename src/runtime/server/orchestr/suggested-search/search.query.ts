import { SuggestedSearchSearchQuery } from '@laioutr-core/canonical-types/suggested-search';
import { defineVtexQuery } from '../../middleware/defineVtex';
import { toSuggestedSearchId } from '../../vtex-helper/suggestedSearch';

export default defineVtexQuery(SuggestedSearchSearchQuery, async ({ input }) => ({
  // The term is the entity: the links below re-read it to produce their results, and nothing is
  // fetched here, so an empty search box costs nothing.
  id: toSuggestedSearchId(input.query ?? ''),
}));
