export type VtexApi =
  | 'catalog'
  | 'catalogSystem'
  | 'checkout'
  | 'logistics'
  | 'vtexid'
  | 'portal'
  | 'reviews'
  | 'pricing';

export interface VtexHostOptions {
  accountName: string;
  environment: string;
}

/**
 * Pricing answers on a separate host from the rest of the platform. Callers pass an API identifier
 * rather than a full URL so that fact stays here instead of leaking into every handler that reads
 * a price.
 */
export const resolveHost = (api: VtexApi, o: VtexHostOptions): string =>
  api === 'pricing'
    ? `https://api.vtex.com/${o.accountName}`
    : `https://${o.accountName}.${o.environment}.com.br`;

export class VtexApiError extends Error {
  constructor(
    readonly status: number,
    readonly api: VtexApi,
    readonly path: string,
    readonly body: unknown
  ) {
    super(`VTEX ${api} responded ${status} for ${path}`);
    this.name = 'VtexApiError';
  }
}

export interface VtexClient {
  publicFetch<T>(api: VtexApi, path: string, init?: RequestInit): Promise<T>;
  adminFetch<T>(api: VtexApi, path: string, init?: RequestInit): Promise<T>;
  readonly isAuthenticated: boolean;
  readonly salesChannel: string;
}

export interface VtexClientDeps {
  accountName: string;
  environment: string;
  appKey: string;
  appToken: string;
  salesChannel: string;
  cookies: Record<string, string>;
  /** Called for each upstream `Set-Cookie`, so the shopper's VTEX session survives the round trip. */
  onSetCookie: (raw: string) => void;
  fetchImpl?: typeof fetch;
}
