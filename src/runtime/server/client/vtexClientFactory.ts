import { forwardableCookieHeader, hasAuthCookie } from './cookies';
import {
  resolveHost,
  type VtexApi,
  VtexApiError,
  type VtexClient,
  type VtexClientDeps,
} from './types';

/**
 * Builds the per-request client. Deliberately performs no I/O: Orchestr runs `extendRequest` for
 * every query and action in the storefront, including ones this app does not handle, so any call
 * made here would fire on requests that have nothing to do with VTEX.
 */
export const createVtexClient = (deps: VtexClientDeps): VtexClient => {
  const doFetch = deps.fetchImpl ?? fetch;
  const cookieHeader = forwardableCookieHeader(deps.cookies, deps.accountName);

  const request = async <T>(
    api: VtexApi,
    path: string,
    init: RequestInit,
    headers: Record<string, string>
  ): Promise<{ data: T; headers: Headers }> => {
    const res = await doFetch(`${resolveHost(api, deps)}${path}`, { ...init, headers });

    const body = await res.json().catch(() => undefined);
    if (!res.ok) throw new VtexApiError(res.status, api, path, body);
    return { data: body as T, headers: res.headers };
  };

  const publicHeaders = (init: RequestInit) => ({
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    ...((init.headers as Record<string, string>) ?? {}),
  });

  return {
    isAuthenticated: hasAuthCookie(deps.cookies, deps.accountName),
    salesChannel: deps.salesChannel,

    publicFetch: async <T>(api: VtexApi, path: string, init: RequestInit = {}) =>
      (await request<T>(api, path, init, publicHeaders(init))).data,

    publicFetchRaw: <T>(api: VtexApi, path: string, init: RequestInit = {}) =>
      request<T>(api, path, init, publicHeaders(init)),

    // No shopper cookie here: an app-authenticated call must not also carry a customer identity.
    adminFetch: async <T>(api: VtexApi, path: string, init: RequestInit = {}) =>
      (await request<T>(api, path, init, {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-VTEX-API-AppKey': deps.appKey,
        'X-VTEX-API-AppToken': deps.appToken,
        ...((init.headers as Record<string, string>) ?? {}),
      })).data,
  };
};
