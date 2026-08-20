export interface SalesChannelOptions {
  salesChannel: string;
  salesChannelByMarket?: Record<string, string>;
}

/**
 * Takes only the market's slug rather than the whole `clientEnv`: `market`, `language` and `domain`
 * are cyclic, so passing the full object invites callers to serialise something that throws.
 */
export const resolveSalesChannel = (market: { slug: string }, o: SalesChannelOptions): string =>
  o.salesChannelByMarket?.[market.slug] ?? o.salesChannel;
