import { describe, expect, it } from 'vitest';
import { authCookieName, forwardableCookieHeader, hasAuthCookie } from './cookies';

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
