import { parseSetCookie } from 'cookie-es';

export const VTEX_SESSION = 'vtex_session';
export const VTEX_SEGMENT = 'vtex_segment';
export const CHECKOUT_ORDER_FORM = 'checkout.vtex.com';

/** VTEX scopes the shopper's auth cookie by account, so two accounts can coexist in one browser. */
export const authCookieName = (accountName: string) => `VtexIdclientAutCookie_${accountName}`;

/**
 * Only VTEX's own cookies go upstream. Forwarding the whole jar would leak the project's session
 * and any analytics cookies to a third party.
 */
export const forwardableCookieHeader = (
  cookies: Record<string, string>,
  accountName: string
): string | undefined => {
  const names = [VTEX_SESSION, VTEX_SEGMENT, CHECKOUT_ORDER_FORM, authCookieName(accountName)];
  const pairs = names.filter((name) => cookies[name]).map((name) => `${name}=${cookies[name]}`);
  return pairs.length ? pairs.join('; ') : undefined;
};

export const hasAuthCookie = (cookies: Record<string, string>, accountName: string) =>
  Boolean(cookies[authCookieName(accountName)]);

export interface VtexCookieWrite {
  name: string;
  value: string;
  expires?: Date;
}

/**
 * VTEX stamps its own domain on every `Set-Cookie`, which a browser rejects on the storefront's
 * origin. Only the name, value and expiry survive the trip; the remaining attributes are the
 * platform's to decide, so that a Studio preview frame gets the partitioned variant it needs.
 */
export const parseVtexSetCookie = (
  raw: string,
  accountName: string
): VtexCookieWrite | undefined => {
  let parsed;
  try {
    parsed = parseSetCookie(raw);
  } catch {
    console.warn('[app-vtex] ignoring an unreadable Set-Cookie from VTEX');
    return undefined;
  }

  const names = [VTEX_SESSION, VTEX_SEGMENT, CHECKOUT_ORDER_FORM, authCookieName(accountName)];
  if (!parsed?.name || !parsed.value || !names.includes(parsed.name)) return undefined;

  return { name: parsed.name, value: parsed.value, expires: parsed.expires };
};
