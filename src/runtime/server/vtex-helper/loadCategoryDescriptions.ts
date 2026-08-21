import type { VtexClient } from '../client/types';

interface VtexAdminCategory {
  Id: number;
  Description?: string | null;
}

/**
 * Category descriptions live on the admin record, one call each — there is no batch form. Only
 * worth doing when a request actually asks for the `content` component, which a category hero does
 * and a card grid does not.
 */
export const loadCategoryDescriptions = async (
  client: VtexClient,
  categoryIds: number[]
): Promise<Map<number, string>> => {
  const entries = await Promise.all(
    categoryIds.map(async (id) => {
      try {
        const category = await client.adminFetch<VtexAdminCategory>(
          'catalog',
          `/api/catalog/pvt/category/${id}`
        );
        return [id, category.Description ?? ''] as const;
      } catch {
        // A description is decoration; losing one must not cost the category its other components.
        return [id, ''] as const;
      }
    })
  );

  return new Map(entries);
};
