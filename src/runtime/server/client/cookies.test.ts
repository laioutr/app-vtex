import { describe, expect, it } from 'vitest';
import {
  authCookieName,
  forwardableCookieHeader,
  hasAuthCookie,
  parseVtexSetCookie,
} from './cookies';

const ACCOUNT = 'laioutrpartner';

describe('authCookieName', () => {
  it('is scoped to the account', () => {
    expect(authCookieName(ACCOUNT)).toBe('VtexIdclientAutCookie_laioutrpartner');
  });
});

describe('forwardableCookieHeader', () => {
  it('forwards only VTEX cookies, not everything the browser sent', () => {
    const header = forwardableCookieHeader(
      {
        vtex_session: 's1',
        vtex_segment: 'g1',
        'checkout.vtex.com': 'c1',
        [authCookieName(ACCOUNT)]: 'a1',
        _ga: 'analytics',
        laioutr_session: 'unrelated',
      },
      ACCOUNT
    );
    expect(header).toContain('vtex_session=s1');
    expect(header).toContain('vtex_segment=g1');
    expect(header).toContain('checkout.vtex.com=c1');
    expect(header).toContain('VtexIdclientAutCookie_laioutrpartner=a1');
    expect(header).not.toContain('_ga');
    expect(header).not.toContain('laioutr_session');
  });

  it('returns undefined when nothing is forwardable, so no empty header is sent', () => {
    expect(forwardableCookieHeader({ _ga: 'x' }, ACCOUNT)).toBeUndefined();
  });

  it('ignores an auth cookie belonging to a different account', () => {
    const header = forwardableCookieHeader({ VtexIdclientAutCookie_other: 'a1' }, ACCOUNT);
    expect(header).toBeUndefined();
  });
});

describe('hasAuthCookie', () => {
  it("is true only for this account's auth cookie", () => {
    expect(hasAuthCookie({ [authCookieName(ACCOUNT)]: 'a1' }, ACCOUNT)).toBe(true);
    expect(hasAuthCookie({ VtexIdclientAutCookie_other: 'a1' }, ACCOUNT)).toBe(false);
    expect(hasAuthCookie({}, ACCOUNT)).toBe(false);
  });

  it('treats an empty value as absent', () => {
    expect(hasAuthCookie({ [authCookieName(ACCOUNT)]: '' }, ACCOUNT)).toBe(false);
  });
});

// The exact header the live account returned, domain and all.
const ORDER_FORM_HEADER =
  'checkout.vtex.com=__ofid=70542a28bdf143eda4178002d09d6b67; expires=Wed, 17 Feb 2027 13:52:15 GMT; ' +
  'domain=laioutrpartner.vtexcommercestable.com.br; path=/; secure; samesite=lax; httponly';

describe('parseVtexSetCookie', () => {
  it('keeps the name and value, including the = inside the value', () => {
    const cookie = parseVtexSetCookie(ORDER_FORM_HEADER, ACCOUNT);
    expect(cookie?.name).toBe('checkout.vtex.com');
    expect(cookie?.value).toBe('__ofid=70542a28bdf143eda4178002d09d6b67');
  });

  it('carries the expiry through', () => {
    expect(parseVtexSetCookie(ORDER_FORM_HEADER, ACCOUNT)?.expires).toEqual(
      new Date('2027-02-17T13:52:15.000Z')
    );
  });

  it('drops the attributes VTEX chose, which are the reason the browser rejected the cookie', () => {
    const cookie = parseVtexSetCookie(ORDER_FORM_HEADER, ACCOUNT);
    expect(cookie).not.toHaveProperty('domain');
    expect(cookie).not.toHaveProperty('secure');
    expect(cookie).not.toHaveProperty('sameSite');
  });

  it('accepts the auth cookie for this account and rejects another account s', () => {
    expect(parseVtexSetCookie(`${authCookieName(ACCOUNT)}=a1; path=/`, ACCOUNT)?.value).toBe('a1');
    expect(parseVtexSetCookie('VtexIdclientAutCookie_other=a1; path=/', ACCOUNT)).toBeUndefined();
  });

  it('ignores a VTEX cookie this app does not forward', () => {
    expect(parseVtexSetCookie('CheckoutOrderFormOwnership=; path=/', ACCOUNT)).toBeUndefined();
  });

  it('returns undefined rather than throwing on a header it cannot read', () => {
    expect(parseVtexSetCookie('', ACCOUNT)).toBeUndefined();
    expect(parseVtexSetCookie('=nonsense', ACCOUNT)).toBeUndefined();
  });
});
