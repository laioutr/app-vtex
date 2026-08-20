# VTEX Read Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the complete read path for `@laioutr/app-vtex` — category, menu, product, product-variant, search and the three page-indexes — bound to canonical Orchestr tokens and verified against a live VTEX account.

**Architecture:** A per-request VTEX client resolves hosts per API (Pricing answers on a different host than everything else) and exposes two fetchers: `publicFetch` forwards shopper cookies, `adminFetch` carries AppKey/AppToken and deliberately does not. `defineVtex` builds that client with zero network calls, because Orchestr runs `extendRequest` on every storefront request including ones this app does not serve. Search, PLP and facets go through a `SearchProvider` interface with a Legacy adapter, because Intelligent Search is not active on the account.

**Tech Stack:** Nuxt 3 module (`@nuxt/kit`), Nitro, `@laioutr-core/orchestr` + `kit` + `canonical-types` + `core-types`, Vitest, `@screeny05/ts-money`, zod.

**Spec:** [`docs/plans/2026-08-20-vtex-wrapper-plan.md`](./2026-08-20-vtex-wrapper-plan.md) — read it alongside this plan. Account state, verified hosts and API traps are in [`docs/environment.md`](../environment.md).

## Global Constraints

- **Money is `{ amount, currency }` with `amount` in minor units and `currency` an ISO 4217 code.** Never a symbol, never lowercase, never a decimal. Checkout returns minor units; Legacy Search and Pricing return decimals.
- **Every URL this app owns is namespaced under `/app-vtex/`.** Never a bare top-level path, never a browser navigation through `/api/laioutr/*`.
- **RuntimeConfig key is the full package name:** `runtimeConfig['@laioutr/app-vtex']`. `configKey: name` from `package.json`.
- **`extendRequest` context keys are namespaced** (`vtexClient`, `vtexAccountName`, `vtexSalesChannel`, `vtexIsAuthenticated`) — that object merges into a context shared by every installed app.
- **`JSON.stringify(clientEnv)` throws.** `market`/`language`/`domain` are cyclic. Pick fields explicitly.
- **Comments explain why, not what.** No design-doc references in code, comments, test names or error messages — no `§5.1`, no file paths, no plan IDs.
- **No Vue component tests.** Tests cover composables, helpers and pure logic.
- **Conventional commits, Angular style:** `feat(scope): …`, `fix: …`, `chore: …`.
- **The product slug is `linkText` (lowercase), not `LinkId`.** Wrong casing returns an empty list, not a 404.
- **`fq=skuId:` does not filter.** Use `fq=productId:`. An unfiltered `products/search` returns nothing — enumerate with `GetProductAndSkuIds`.

## File Structure

```
scripts/seed-sandbox.ts                              one-off fixture seeding, not shipped
vitest.config.ts                                     plain defineConfig; includes src/** AND test/**
src/module.ts                                        ModuleOptions, runtimeConfig split
src/runtime/server/
  client/types.ts                                    VtexApi, VtexClient, VtexApiError, resolveHost
  client/cookies.ts                                  VTEX cookie names, forwarding, auth detection
  client/vtexClientFactory.ts                        builds publicFetch/adminFetch, no network
  client/salesChannel.ts                             market -> sales channel via explicit map
  middleware/defineVtex.ts                            the Orchestr builder and its exports
  search/types.ts                                    SearchProvider interface
  search/legacy.ts                                   Legacy Search adapter
  vtex-helper/money.ts                               fromMinorUnits / fromDecimal
  vtex-helper/categoryTree.ts                        tree load, slug->id, breadcrumb, category path
  vtex-helper/mappers/product.ts                     VTEX product -> canonical components
  orchestr/category/*.ts                             queries, links, resolver
  orchestr/menu/*.ts                                 byAlias query + template
  orchestr/product/*.ts                              queries, links, resolver, page-indexes
  orchestr/product-variant/base.resolver.ts          variant components
```

Each file has one responsibility. `client/` knows nothing about canonical types; `orchestr/` knows nothing about VTEX hosts.

---

## Task 1: Sandbox fixture seeding

> **Check before starting: this task may already be done.** A parallel session was asked to seed the
> catalog. Running this twice creates duplicate products, and the script has no idempotency guard
> beyond `ensureCategory`. Verify first:
> ```bash
> source .env
> curl -s -H "X-VTEX-API-AppKey: $VTEX_APP_KEY" -H "X-VTEX-API-AppToken: $VTEX_APP_TOKEN" \\
>   "https://$VTEX_ACCOUNT_NAME.$VTEX_ENVIRONMENT.com.br/api/catalog_system/pvt/products/GetProductAndSkuIds?_from=1&_to=50" \\
>   | python3 -c "import json,sys; print(json.load(sys.stdin)['range']['total'], 'products')"
> ```
> More than a couple of products means seeding already happened — skip to Task 2 and keep the script
> as the record of how the fixtures were built.

The catalog holds one usable product, so listing, facets, pagination and variants cannot be verified. This task creates the fixture set everything downstream is tested against.

**Files:**
- Create: `scripts/seed-sandbox.ts`

**Interfaces:**
- Consumes: nothing (standalone script, reads `.env` directly)
- Produces: a seeded VTEX catalog. No exported symbols other tasks import.

**Ordering is forced by VTEX:** create product -> create SKU -> **attach image** -> set price -> set inventory -> **activate SKU**. Activation fails with *"does not have any files associated to it yet"* if the image is missing, and the file-by-URL endpoint returns intermittent 500 SQL timeouts, so it needs retries.

- [ ] **Step 1: Write the script skeleton with the retry helper**

```ts
// scripts/seed-sandbox.ts
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])
);

const BASE = `https://${env.VTEX_ACCOUNT_NAME}.${env.VTEX_ENVIRONMENT}.com.br`;
const headers = {
  'X-VTEX-API-AppKey': env.VTEX_APP_KEY,
  'X-VTEX-API-AppToken': env.VTEX_APP_TOKEN,
  'Content-Type': 'application/json',
  Accept: 'application/json',
};

/** VTEX's file-by-URL insert returns sporadic 500 SQL timeouts; one retry is usually enough. */
async function call<T>(path: string, init: RequestInit = {}, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    const res = await fetch(`${BASE}${path}`, { ...init, headers });
    if (res.ok) return (await res.json()) as T;
    lastError = new Error(`${res.status} ${path}: ${await res.text()}`);
  }
  throw lastError;
}
```

- [ ] **Step 2: Add the fixture definitions**

Prices are spread deliberately — `PriceRanges` is empty today because one product means one price.

```ts
interface Fixture {
  name: string;
  categoryId: number;
  brandId: number;
  price: number;          // decimal, as the Pricing API expects
  skus: { name: string; ean?: string }[];
}

const BRAND_ID = 2000001; // FILA, already on the account

const FIXTURES: Fixture[] = [
  { name: 'Runner Low',      categoryId: 4, brandId: BRAND_ID, price: 39.9,  skus: [{ name: 'Runner Low 38' }] },
  { name: 'Court Classic',   categoryId: 4, brandId: BRAND_ID, price: 59.95, skus: [{ name: 'Court Classic 39' }] },
  { name: 'Trail Mid',       categoryId: 4, brandId: BRAND_ID, price: 89.0,  skus: [{ name: 'Trail Mid 40' }] },
  { name: 'City Slip',       categoryId: 5, brandId: BRAND_ID, price: 44.5,  skus: [{ name: 'City Slip 37' }] },
  { name: 'Canvas Tote',     categoryId: 7, brandId: BRAND_ID, price: 24.99, skus: [{ name: 'Canvas Tote One Size' }] },
  { name: 'Leather Shopper', categoryId: 7, brandId: BRAND_ID, price: 149.0, skus: [{ name: 'Leather Shopper One Size' }] },
  // Multi-SKU, so ProductVariantsLink and ProductVariantOptions have something to resolve.
  { name: 'Everyday Sneaker', categoryId: 4, brandId: BRAND_ID, price: 69.9, skus: [
      { name: 'Everyday Sneaker 38' }, { name: 'Everyday Sneaker 39' }, { name: 'Everyday Sneaker 40' },
  ] },
];
```

- [ ] **Step 3: Add the second category branch**

`ChildCategoriesLink` and breadcrumbs need siblings and depth. Category `2` is `Damen`; this adds `Taschen` (id assigned by VTEX, referenced as 7 above — read the response and substitute the real id).

```ts
async function ensureCategory(name: string, fatherCategoryId: number | null) {
  const existing = await fetch(`${BASE}/api/catalog_system/pub/category/tree/5`).then((r) => r.json());
  const flat = (nodes: any[]): any[] => nodes.flatMap((n) => [n, ...flat(n.children ?? [])]);
  const hit = flat(existing).find((c) => c.name === name);
  if (hit) return hit.id as number;

  const created = await call<{ Id: number }>('/api/catalog/pvt/category', {
    method: 'POST',
    body: JSON.stringify({
      Name: name, FatherCategoryId: fatherCategoryId, IsActive: true,
      ShowInStoreFront: true, ShowBrandFilter: true, ActiveStoreFrontLink: true,
      GlobalCategoryId: 1, AdWordsRemarketingCode: null, LomadeeCampaignCode: null,
    }),
  });
  return created.Id;
}
```

- [ ] **Step 4: Add the per-product seeding sequence**

```ts
async function seedProduct(f: Fixture, categoryId: number) {
  const product = await call<{ Id: number }>('/api/catalog/pvt/product', {
    method: 'POST',
    body: JSON.stringify({
      Name: f.name, CategoryId: categoryId, BrandId: f.brandId,
      LinkId: f.name.toLowerCase().replace(/\s+/g, '-'),
      RefId: f.name.toLowerCase().replace(/\s+/g, '-'),
      IsActive: true, IsVisible: true, ShowWithoutStock: true,
      Title: f.name, Description: `${f.name} — seeded fixture.`,
    }),
  });

  for (const sku of f.skus) {
    const created = await call<{ Id: number }>('/api/catalog/pvt/stockkeepingunit', {
      method: 'POST',
      body: JSON.stringify({
        ProductId: product.Id, Name: sku.name, IsActive: false, ActivateIfPossible: false,
        RefId: sku.name.toLowerCase().replace(/\s+/g, '-'),
        PackagedHeight: 1, PackagedLength: 1, PackagedWidth: 1, PackagedWeightKg: 1,
        Height: 1, Length: 1, Width: 1, WeightKg: 1,
        CubicWeight: 0, IsKit: false, MeasurementUnit: 'un', UnitMultiplier: 1,
      }),
    });

    // Image first — VTEX refuses to activate a SKU with no files.
    await call(`/api/catalog/pvt/stockkeepingunit/${created.Id}/file`, {
      method: 'POST',
      body: JSON.stringify({
        IsMain: true, Label: 'main', Name: 'placeholder',
        Url: 'https://placehold.co/400x400.png',
      }),
    });

    await fetch(`https://api.vtex.com/${env.VTEX_ACCOUNT_NAME}/pricing/prices/${created.Id}`, {
      method: 'PUT', headers,
      body: JSON.stringify({ markup: 0, basePrice: f.price, costPrice: f.price }),
    });

    await fetch(`${BASE}/api/logistics/pvt/inventory/skus/${created.Id}/warehouses/1_1`, {
      method: 'PUT', headers,
      body: JSON.stringify({ unlimitedQuantity: false, quantity: 100, dateUtcOnBalanceSystem: null }),
    });

    const full = await call<Record<string, unknown>>(`/api/catalog/pvt/stockkeepingunit/${created.Id}`);
    await call(`/api/catalog/pvt/stockkeepingunit/${created.Id}`, {
      method: 'PUT',
      body: JSON.stringify({ ...full, IsActive: true, ActivateIfPossible: true }),
    });

    console.log(`  seeded SKU ${created.Id} — ${sku.name}`);
  }
}
```

- [ ] **Step 5: Add the entry point and run it**

```ts
const taschen = await ensureCategory('Taschen', 2);
for (const f of FIXTURES) {
  await seedProduct(f, f.categoryId === 7 ? taschen : f.categoryId);
}
console.log('done');
```

Run: `pnpm exec tsx scripts/seed-sandbox.ts` (add `tsx` as a devDependency if absent).
Expected: one `seeded SKU …` line per SKU, no throws.

- [ ] **Step 6: Verify the catalog reflects it**

Run:
```bash
source .env
curl -s "https://$VTEX_ACCOUNT_NAME.$VTEX_ENVIRONMENT.com.br/api/catalog_system/pub/products/search?fq=C:/2/&_from=0&_to=49" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d), 'products')"
```
Expected: 8 or more products. Catalog indexing lags — if the count is low, re-run after a few minutes rather than re-seeding.

- [ ] **Step 7: Commit**

```bash
git add scripts/seed-sandbox.ts package.json pnpm-lock.yaml
git commit -m "chore: add sandbox fixture seeding script"
```

---

## Task 2: Money helpers and the Vitest config

**Files:**
- Create: `vitest.config.ts`
- Create: `src/runtime/server/vtex-helper/money.ts`
- Test: `src/runtime/server/vtex-helper/money.test.ts`
- Modify: `package.json` (add `@screeny05/ts-money`)

**Interfaces:**
- Consumes: nothing.
- Produces: `fromMinorUnits(amount: number, currency: string): Money` and `fromDecimal(amount: number, currency: string): Money`, both returning `Money` from `@screeny05/ts-money`.

VTEX is not consistent: Checkout returns integer minor units, Legacy Search and Pricing return decimals. Every conversion goes through here so no handler does arithmetic itself.

- [ ] **Step 1: Add the dependency and the Vitest config**

```bash
pnpm add @screeny05/ts-money
pnpm add -D tsx
```

`vitest.config.ts` — note **both** globs. `src/**` picks up the unit suites; `test/**` keeps the existing SSR e2e running, which guards that the app credentials never reach the client payload.

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Plain `defineConfig` rather than `@nuxt/test-utils`' `defineVitestConfig`: that helper boots
    // a Nuxt instance and pulls in happy-dom to build a DOM these suites never touch, and it
    // regenerates the root `.nuxt` without the playground's config, leaving `vue-tsc` reporting
    // phantom errors until the next `pnpm dev:prepare`.
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    environment: 'node',
  },
});
```

- [ ] **Step 2: Write the failing test**

```ts
// src/runtime/server/vtex-helper/money.test.ts
import { describe, expect, it } from 'vitest';
import { fromDecimal, fromMinorUnits } from './money';

describe('fromMinorUnits', () => {
  it('treats the input as minor units', () => {
    const m = fromMinorUnits(1099, 'EUR');
    expect(m.getAmount()).toBe(1099);
    expect(m.getCurrency()).toBe('EUR');
  });

  it('rounds a fractional minor unit rather than truncating', () => {
    expect(fromMinorUnits(1099.6, 'EUR').getAmount()).toBe(1100);
  });
});

describe('fromDecimal', () => {
  it('converts a decimal price to minor units', () => {
    const m = fromDecimal(49.99, 'EUR');
    expect(m.getAmount()).toBe(4999);
    expect(m.getCurrency()).toBe('EUR');
  });

  it('handles a whole-number decimal', () => {
    expect(fromDecimal(89, 'EUR').getAmount()).toBe(8900);
  });

  it('rounds binary-float artefacts to the nearest minor unit', () => {
    // 0.1 + 0.2 style drift: 8.115 * 100 is 811.4999... in IEEE 754.
    expect(fromDecimal(8.115, 'EUR').getAmount()).toBe(812);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm vitest run src/runtime/server/vtex-helper/money.test.ts`
Expected: FAIL — `Failed to resolve import "./money"`.

- [ ] **Step 4: Write the implementation**

```ts
// src/runtime/server/vtex-helper/money.ts
import { Money } from '@screeny05/ts-money';

/**
 * Checkout returns every monetary value in minor units already — `1099` is EUR 10.99.
 */
export const fromMinorUnits = (amount: number, currency: string): Money =>
  new Money(Math.round(amount), currency);

/**
 * Legacy Search and the Pricing API return decimals. `Math.round` on the scaled value keeps
 * binary-float drift from silently losing a cent.
 */
export const fromDecimal = (amount: number, currency: string): Money =>
  new Money(Math.round(amount * 100), currency);
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm vitest run src/runtime/server/vtex-helper/money.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Confirm the e2e suite still runs**

Run: `pnpm test`
Expected: both files collected — `src/runtime/server/vtex-helper/money.test.ts` and `test/basic.test.ts`, 7 tests passing. If `test/basic.test.ts` is missing from the output, the `include` globs are wrong.

- [ ] **Step 7: Commit**

```bash
git add vitest.config.ts src/runtime/server/vtex-helper/money.ts src/runtime/server/vtex-helper/money.test.ts package.json pnpm-lock.yaml
git commit -m "feat: add money conversion helpers"
```

---

## Task 3: VTEX cookie helpers

**Files:**
- Create: `src/runtime/server/client/cookies.ts`
- Test: `src/runtime/server/client/cookies.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `VTEX_SESSION`, `VTEX_SEGMENT`, `CHECKOUT_ORDER_FORM` — cookie-name constants
  - `authCookieName(accountName: string): string`
  - `forwardableCookieHeader(cookies: Record<string, string>, accountName: string): string | undefined`
  - `hasAuthCookie(cookies: Record<string, string>, accountName: string): boolean`

Both functions take a plain cookie record rather than an `H3Event`, so they are testable without constructing a request.

- [ ] **Step 1: Write the failing test**

```ts
// src/runtime/server/client/cookies.test.ts
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
  it('is true only for this account\'s auth cookie', () => {
    expect(hasAuthCookie({ [authCookieName(ACCOUNT)]: 'a1' }, ACCOUNT)).toBe(true);
    expect(hasAuthCookie({ VtexIdclientAutCookie_other: 'a1' }, ACCOUNT)).toBe(false);
    expect(hasAuthCookie({}, ACCOUNT)).toBe(false);
  });

  it('treats an empty value as absent', () => {
    expect(hasAuthCookie({ [authCookieName(ACCOUNT)]: '' }, ACCOUNT)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/runtime/server/client/cookies.test.ts`
Expected: FAIL — cannot resolve `./cookies`.

- [ ] **Step 3: Write the implementation**

```ts
// src/runtime/server/client/cookies.ts

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
  const pairs = names
    .filter((name) => cookies[name])
    .map((name) => `${name}=${cookies[name]}`);
  return pairs.length ? pairs.join('; ') : undefined;
};

export const hasAuthCookie = (cookies: Record<string, string>, accountName: string) =>
  Boolean(cookies[authCookieName(accountName)]);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/runtime/server/client/cookies.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/server/client/cookies.ts src/runtime/server/client/cookies.test.ts
git commit -m "feat: add VTEX cookie helpers"
```

---

## Task 4: Host resolution, client types and the VTEX client factory

**Files:**
- Create: `src/runtime/server/client/types.ts`
- Create: `src/runtime/server/client/vtexClientFactory.ts`
- Test: `src/runtime/server/client/types.test.ts`
- Test: `src/runtime/server/client/vtexClientFactory.test.ts`

**Interfaces:**
- Consumes: `forwardableCookieHeader`, `hasAuthCookie`, `authCookieName` from Task 3.
- Produces:
  - `type VtexApi = 'catalog' | 'catalogSystem' | 'checkout' | 'logistics' | 'vtexid' | 'portal' | 'reviews' | 'pricing'`
  - `resolveHost(api: VtexApi, o: { accountName: string; environment: string }): string`
  - `class VtexApiError extends Error` with `status: number`, `api: VtexApi`, `path: string`, `body: unknown`
  - `interface VtexClient { publicFetch<T>(api, path, init?): Promise<T>; adminFetch<T>(api, path, init?): Promise<T>; readonly isAuthenticated: boolean; readonly salesChannel: string }`
  - `createVtexClient(deps: VtexClientDeps): VtexClient`

`createVtexClient` takes `fetchImpl`, `cookies`, `setCookie` and the resolved options as plain values rather than an `H3Event`, so the suite tests it without a server.

- [ ] **Step 1: Write the failing test for host resolution**

```ts
// src/runtime/server/client/types.test.ts
import { describe, expect, it } from 'vitest';
import { resolveHost, VtexApiError } from './types';

const o = { accountName: 'laioutrpartner', environment: 'vtexcommercestable' };

describe('resolveHost', () => {
  it('puts Pricing on api.vtex.com, which is a different host from everything else', () => {
    expect(resolveHost('pricing', o)).toBe('https://api.vtex.com/laioutrpartner');
  });

  it.each(['catalog', 'catalogSystem', 'checkout', 'logistics', 'vtexid', 'portal', 'reviews'] as const)(
    'puts %s on the account domain',
    (api) => {
      expect(resolveHost(api, o)).toBe('https://laioutrpartner.vtexcommercestable.com.br');
    }
  );

  it('honours the myvtex environment', () => {
    expect(resolveHost('catalog', { ...o, environment: 'myvtex' }))
      .toBe('https://laioutrpartner.myvtex.com.br');
  });
});

describe('VtexApiError', () => {
  it('carries enough context to identify the failing call', () => {
    const err = new VtexApiError(404, 'catalog', '/api/catalog/pvt/product/1', { message: 'nope' });
    expect(err.status).toBe(404);
    expect(err.api).toBe('catalog');
    expect(err.path).toBe('/api/catalog/pvt/product/1');
    expect(err.body).toEqual({ message: 'nope' });
    expect(err.message).toContain('404');
    expect(err.message).toContain('/api/catalog/pvt/product/1');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run src/runtime/server/client/types.test.ts`
Expected: FAIL — cannot resolve `./types`.

- [ ] **Step 3: Write the types module**

```ts
// src/runtime/server/client/types.ts

export type VtexApi =
  | 'catalog' | 'catalogSystem' | 'checkout' | 'logistics'
  | 'vtexid' | 'portal' | 'reviews' | 'pricing';

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
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm vitest run src/runtime/server/client/types.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Write the failing test for the client factory**

The cookie-forwarding asymmetry is the important behaviour here: a server-to-server call must not carry a shopper's identity.

```ts
// src/runtime/server/client/vtexClientFactory.test.ts
import { describe, expect, it, vi } from 'vitest';
import { createVtexClient } from './vtexClientFactory';
import { VtexApiError } from './types';
import { authCookieName } from './cookies';

const ACCOUNT = 'laioutrpartner';

const ok = (body: unknown = { ok: true }) =>
  vi.fn().mockResolvedValue({
    ok: true, status: 200,
    json: async () => body,
    headers: { getSetCookie: () => [] },
  });

const deps = (fetchImpl: ReturnType<typeof vi.fn>, cookies: Record<string, string> = {}) => ({
  accountName: ACCOUNT,
  environment: 'vtexcommercestable',
  appKey: 'KEY',
  appToken: 'TOKEN',
  salesChannel: '1',
  cookies,
  onSetCookie: vi.fn(),
  fetchImpl: fetchImpl as unknown as typeof fetch,
});

describe('createVtexClient', () => {
  it('makes no network call while being constructed', () => {
    const f = ok();
    createVtexClient(deps(f));
    expect(f).not.toHaveBeenCalled();
  });

  it('publicFetch forwards VTEX cookies and sends no app credentials', async () => {
    const f = ok();
    const client = createVtexClient(deps(f, { vtex_session: 's1', [authCookieName(ACCOUNT)]: 'a1' }));
    await client.publicFetch('catalogSystem', '/api/catalog_system/pub/category/tree/3');

    const [url, init] = f.mock.calls[0];
    expect(url).toBe('https://laioutrpartner.vtexcommercestable.com.br/api/catalog_system/pub/category/tree/3');
    expect(init.headers.Cookie).toContain('vtex_session=s1');
    expect(init.headers['X-VTEX-API-AppKey']).toBeUndefined();
    expect(init.headers['X-VTEX-API-AppToken']).toBeUndefined();
  });

  it('adminFetch sends app credentials and deliberately forwards no shopper cookie', async () => {
    const f = ok();
    const client = createVtexClient(deps(f, { vtex_session: 's1', [authCookieName(ACCOUNT)]: 'a1' }));
    await client.adminFetch('pricing', '/pricing/prices/1');

    const [url, init] = f.mock.calls[0];
    expect(url).toBe('https://api.vtex.com/laioutrpartner/pricing/prices/1');
    expect(init.headers['X-VTEX-API-AppKey']).toBe('KEY');
    expect(init.headers['X-VTEX-API-AppToken']).toBe('TOKEN');
    // A server-to-server call carrying a shopper identity would resolve a different context.
    expect(init.headers.Cookie).toBeUndefined();
  });

  it('propagates upstream Set-Cookie so the VTEX session survives', async () => {
    const f = vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({}),
      headers: { getSetCookie: () => ['vtex_segment=g2; Path=/'] },
    });
    const onSetCookie = vi.fn();
    const client = createVtexClient({ ...deps(f), onSetCookie });
    await client.publicFetch('checkout', '/api/checkout/pub/orderForm');
    expect(onSetCookie).toHaveBeenCalledWith('vtex_segment=g2; Path=/');
  });

  it('throws VtexApiError carrying the status, api and path', async () => {
    const f = vi.fn().mockResolvedValue({
      ok: false, status: 404, json: async () => ({ message: 'not found' }),
      headers: { getSetCookie: () => [] },
    });
    const client = createVtexClient(deps(f));
    await expect(client.publicFetch('catalog', '/api/catalog/pvt/product/999'))
      .rejects.toMatchObject({ status: 404, api: 'catalog', path: '/api/catalog/pvt/product/999' });
    await expect(client.publicFetch('catalog', '/api/catalog/pvt/product/999'))
      .rejects.toBeInstanceOf(VtexApiError);
  });

  it('exposes isAuthenticated from the account\'s auth cookie', () => {
    expect(createVtexClient(deps(ok(), { [authCookieName(ACCOUNT)]: 'a1' })).isAuthenticated).toBe(true);
    expect(createVtexClient(deps(ok(), { VtexIdclientAutCookie_other: 'a1' })).isAuthenticated).toBe(false);
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm vitest run src/runtime/server/client/vtexClientFactory.test.ts`
Expected: FAIL — cannot resolve `./vtexClientFactory`.

- [ ] **Step 7: Write the factory**

```ts
// src/runtime/server/client/vtexClientFactory.ts
import { forwardableCookieHeader, hasAuthCookie } from './cookies';
import { resolveHost, VtexApiError, type VtexApi, type VtexClient, type VtexClientDeps } from './types';

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
  ): Promise<T> => {
    const res = await doFetch(`${resolveHost(api, deps)}${path}`, { ...init, headers });

    for (const raw of res.headers.getSetCookie?.() ?? []) deps.onSetCookie(raw);

    const body = await res.json().catch(() => undefined);
    if (!res.ok) throw new VtexApiError(res.status, api, path, body);
    return body as T;
  };

  return {
    isAuthenticated: hasAuthCookie(deps.cookies, deps.accountName),
    salesChannel: deps.salesChannel,

    publicFetch: (api, path, init = {}) =>
      request(api, path, init, {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
        ...((init.headers as Record<string, string>) ?? {}),
      }),

    // No shopper cookie here: an app-authenticated call must not also carry a customer identity.
    adminFetch: (api, path, init = {}) =>
      request(api, path, init, {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-VTEX-API-AppKey': deps.appKey,
        'X-VTEX-API-AppToken': deps.appToken,
        ...((init.headers as Record<string, string>) ?? {}),
      }),
  };
};
```

- [ ] **Step 8: Run it to verify it passes**

Run: `pnpm vitest run src/runtime/server/client/vtexClientFactory.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 9: Commit**

```bash
git add src/runtime/server/client/
git commit -m "feat: add VTEX client with per-API host resolution"
```

---

## Task 5: Sales channel resolution and ModuleOptions

**Files:**
- Create: `src/runtime/server/client/salesChannel.ts`
- Test: `src/runtime/server/client/salesChannel.test.ts`
- Modify: `src/module.ts` (add `salesChannelByMarket`, `searchProvider` to `ModuleOptions` and defaults)

**Interfaces:**
- Consumes: nothing.
- Produces: `resolveSalesChannel(market: { slug: string }, o: { salesChannel: string; salesChannelByMarket?: Record<string, string> }): string`

Mapping is explicit rather than matched on currency: two trade policies can share a currency (B2B and B2C), and matching would need an `adminFetch` at boot because channels list only on the private path.

- [ ] **Step 1: Write the failing test**

```ts
// src/runtime/server/client/salesChannel.test.ts
import { describe, expect, it } from 'vitest';
import { resolveSalesChannel } from './salesChannel';

describe('resolveSalesChannel', () => {
  const options = { salesChannel: '1', salesChannelByMarket: { switzerland: '2', austria: '3' } };

  it('uses the mapped channel for a known market', () => {
    expect(resolveSalesChannel({ slug: 'switzerland' }, options)).toBe('2');
  });

  it('falls back to the default for an unmapped market', () => {
    expect(resolveSalesChannel({ slug: 'germany' }, options)).toBe('1');
  });

  it('falls back to the default when no map is configured at all', () => {
    expect(resolveSalesChannel({ slug: 'switzerland' }, { salesChannel: '1' })).toBe('1');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run src/runtime/server/client/salesChannel.test.ts`
Expected: FAIL — cannot resolve `./salesChannel`.

- [ ] **Step 3: Write the implementation**

```ts
// src/runtime/server/client/salesChannel.ts

export interface SalesChannelOptions {
  salesChannel: string;
  salesChannelByMarket?: Record<string, string>;
}

/**
 * Takes only the market's slug rather than the whole `clientEnv`: `market`, `language` and `domain`
 * are cyclic, so passing the full object invites callers to serialise something that throws.
 */
export const resolveSalesChannel = (
  market: { slug: string },
  o: SalesChannelOptions
): string => o.salesChannelByMarket?.[market.slug] ?? o.salesChannel;
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm vitest run src/runtime/server/client/salesChannel.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Extend ModuleOptions**

In `src/module.ts`, add to the `ModuleOptions` interface:

```ts
  /** Market slug -> VTEX sales channel id. Falls back to {@link ModuleOptions.salesChannel}. */
  salesChannelByMarket?: Record<string, string>;
  /** Which search backend to use. Intelligent Search requires an active VTEX IO store. */
  searchProvider: 'legacy' | 'intelligent';
```

and to `defaults`:

```ts
    searchProvider: 'legacy',
```

`salesChannelByMarket` gets no default — absent means "always use `salesChannel`".

Keep both out of the public runtime config; only `accountName`, `environment` and `salesChannel` are public.

- [ ] **Step 6: Verify the module still builds and nothing leaked**

Run: `pnpm run dev:prepare && pnpm test`
Expected: build succeeds; the credential-leak test in `test/basic.test.ts` still passes.

- [ ] **Step 7: Commit**

```bash
git add src/runtime/server/client/salesChannel.ts src/runtime/server/client/salesChannel.test.ts src/module.ts
git commit -m "feat: resolve the sales channel from an explicit market map"
```

---

## Task 6: The `defineVtex` Orchestr builder

**Files:**
- Create: `src/runtime/server/middleware/defineVtex.ts`

**Interfaces:**
- Consumes: `createVtexClient` (Task 4), `resolveSalesChannel` (Task 5).
- Produces: `defineVtex`, plus `defineVtexQuery`, `defineVtexAction`, `defineVtexLink`, `defineVtexComponentResolver`, `defineVtexPageIndex`, `defineVtexQueryTemplateProvider`. Every handler in Tasks 8–15 imports from here.
- Context shape produced for all handlers: `{ vtexClient: VtexClient; vtexAccountName: string; vtexSalesChannel: string; vtexIsAuthenticated: boolean }`.

No unit test: this file is a registration wiring whose behaviour is exercised by every handler suite and by the playground. Testing it in isolation would mean mocking `defineOrchestr` itself.

- [ ] **Step 1: Write the builder**

```ts
// src/runtime/server/middleware/defineVtex.ts
import { defineOrchestr, useRuntimeConfig } from '#imports';
import { appendResponseHeader, parseCookies } from 'h3';
import { createVtexClient } from '../client/vtexClientFactory';
import { resolveSalesChannel } from '../client/salesChannel';
import { name } from '../../../../package.json';

export const defineVtex = defineOrchestr
  .meta({
    app: name,
    label: 'VTEX',
    logoUrl: '/app-vtex/vtex-logo.svg',
  })
  .extendRequest(async (args) => {
    const config = useRuntimeConfig()[name] as {
      accountName: string;
      environment: string;
      appKey: string;
      appToken: string;
      salesChannel: string;
      salesChannelByMarket?: Record<string, string>;
    };

    const salesChannel = resolveSalesChannel(args.clientEnv.market, config);

    const vtexClient = createVtexClient({
      accountName: config.accountName,
      environment: config.environment,
      appKey: config.appKey,
      appToken: config.appToken,
      salesChannel,
      cookies: parseCookies(args.event),
      onSetCookie: (raw) => appendResponseHeader(args.event, 'set-cookie', raw),
    });

    // Keys are namespaced: this object merges into a context shared by every installed app.
    return {
      context: {
        vtexClient,
        vtexAccountName: config.accountName,
        vtexSalesChannel: salesChannel,
        vtexIsAuthenticated: vtexClient.isAuthenticated,
      },
    };
  });

export const defineVtexQuery = defineVtex.queryHandler;
export const defineVtexAction = defineVtex.actionHandler;
export const defineVtexLink = defineVtex.linkHandler;
export const defineVtexComponentResolver = defineVtex.componentResolver;
export const defineVtexPageIndex = defineVtex.pageIndex;
export const defineVtexQueryTemplateProvider = defineVtex.queryTemplateProvider;
```

- [ ] **Step 2: Verify it type-checks and the module still builds**

Run: `pnpm run dev:prepare && pnpm exec vue-tsc --noEmit`
Expected: build succeeds. Three pre-existing errors remain (two `TS2717` in `globalExtensions.ts`, one `defineNitroPlugin` in `zodFix.ts`) — they reproduce identically in `app-starter` and are not caused by this task. Any *new* error is.

- [ ] **Step 3: Commit**

```bash
git add src/runtime/server/middleware/defineVtex.ts
git commit -m "feat: add the defineVtex orchestr builder"
```

---

## Task 7: SearchProvider interface and the Legacy adapter

**Files:**
- Create: `src/runtime/server/search/types.ts`
- Create: `src/runtime/server/search/legacy.ts`
- Test: `src/runtime/server/search/legacy.test.ts`
- Modify: `src/runtime/server/client/types.ts` and `vtexClientFactory.ts` — add `publicFetchRaw`

**Interfaces:**
- Consumes: `VtexClient` (Task 4).
- Produces:
  - `interface SearchProvider` with `id`, `searchProducts`, `facets`, optional `suggestions`
  - `createLegacySearchProvider(client: VtexClient): SearchProvider`
  - On `VtexClient`: `publicFetchRaw<T>(api, path, init?): Promise<{ data: T; headers: Headers }>`

**Why the client needs a raw variant:** Legacy Search returns the result count in the `resources` response header (`items 0-8/42`), not in the body. `publicFetch` discards headers, so the total would be unobtainable. This is the only consumer that needs headers, so `publicFetch` keeps its simpler shape and delegates to the raw form.

- [ ] **Step 1: Add `publicFetchRaw` to the client**

In `client/types.ts`, add to `VtexClient`:

```ts
  /** Legacy Search reports its total in the `resources` header, which `publicFetch` discards. */
  publicFetchRaw<T>(api: VtexApi, path: string, init?: RequestInit): Promise<{ data: T; headers: Headers }>;
```

In `vtexClientFactory.ts`, change `request` to return both and have `publicFetch` unwrap it:

```ts
  const request = async <T>(api, path, init, headers): Promise<{ data: T; headers: Headers }> => {
    const res = await doFetch(`${resolveHost(api, deps)}${path}`, { ...init, headers });
    for (const raw of res.headers.getSetCookie?.() ?? []) deps.onSetCookie(raw);
    const body = await res.json().catch(() => undefined);
    if (!res.ok) throw new VtexApiError(res.status, api, path, body);
    return { data: body as T, headers: res.headers };
  };
```

Then `publicFetch` returns `(await request(...)).data`, `publicFetchRaw` returns the whole object, and `adminFetch` returns `.data`.

- [ ] **Step 2: Run the existing client suite to confirm nothing regressed**

Run: `pnpm vitest run src/runtime/server/client/vtexClientFactory.test.ts`
Expected: PASS, 6 tests. The mocks return `headers: { getSetCookie: () => [] }`, which satisfies the new return shape.

- [ ] **Step 3: Write the interface**

```ts
// src/runtime/server/search/types.ts
import type { AvailableFilter } from '@laioutr-core/orchestr/types';

export interface SearchProductsInput {
  term?: string;
  /** VTEX category path, e.g. '/2/3/'. */
  categoryPath?: string;
  from: number;
  to: number;
  salesChannel: string;
}

export interface SuggestionResult {
  terms: string[];
}

export interface SearchProvider {
  readonly id: 'legacy' | 'intelligent';

  /** Returns ids and a total; hydration belongs to the resolver. */
  searchProducts(input: SearchProductsInput): Promise<{ productIds: string[]; total: number }>;

  facets(input: { term?: string; categoryId?: string; salesChannel: string }): Promise<AvailableFilter[]>;

  /**
   * Optional on purpose: Legacy Search has no autocomplete, so its absence is a type-level fact
   * and the suggestion handler is simply not registered rather than failing at request time.
   */
  suggestions?(input: { term: string }): Promise<SuggestionResult>;
}
```

- [ ] **Step 4: Write the failing test for the Legacy adapter**

```ts
// src/runtime/server/search/legacy.test.ts
import { describe, expect, it, vi } from 'vitest';
import { createLegacySearchProvider } from './legacy';
import type { VtexClient } from '../client/types';

const client = (raw: ReturnType<typeof vi.fn>, pub = vi.fn()) =>
  ({ publicFetchRaw: raw, publicFetch: pub } as unknown as VtexClient);

const withResources = (data: unknown, resources: string) =>
  vi.fn().mockResolvedValue({ data, headers: new Headers({ resources }) });

describe('createLegacySearchProvider', () => {
  it('reads the total from the resources header, not the body', async () => {
    const raw = withResources([{ productId: '1' }, { productId: '2' }], 'items 0-1/42');
    const provider = createLegacySearchProvider(client(raw));
    await expect(provider.searchProducts({ from: 0, to: 1, salesChannel: '1', term: 'sneaker' }))
      .resolves.toEqual({ productIds: ['1', '2'], total: 42 });
  });

  it('falls back to the result count when the header is missing', async () => {
    const raw = vi.fn().mockResolvedValue({ data: [{ productId: '1' }], headers: new Headers() });
    const provider = createLegacySearchProvider(client(raw));
    await expect(provider.searchProducts({ from: 0, to: 9, salesChannel: '1' }))
      .resolves.toEqual({ productIds: ['1'], total: 1 });
  });

  it('searches by full text with ft', async () => {
    const raw = withResources([], 'items 0-0/0');
    await createLegacySearchProvider(client(raw))
      .searchProducts({ term: 'sneaker', from: 0, to: 9, salesChannel: '1' });
    const path = raw.mock.calls[0][1] as string;
    expect(path).toContain('ft=sneaker');
    expect(path).toContain('_from=0');
    expect(path).toContain('_to=9');
    expect(path).toContain('sc=1');
  });

  it('filters by category path with fq=C:, which is how a PLP lists', async () => {
    const raw = withResources([], 'items 0-0/0');
    await createLegacySearchProvider(client(raw))
      .searchProducts({ categoryPath: '/2/3/', from: 0, to: 9, salesChannel: '1' });
    expect(raw.mock.calls[0][1]).toContain('fq=C%3A%2F2%2F3%2F');
  });

  it('maps legacy facet groups onto AvailableFilter', async () => {
    const pub = vi.fn().mockResolvedValue({
      Departments: [{ Name: 'Damen', Quantity: 3, Link: '/damen' }],
      Brands: [{ Name: 'FILA', Quantity: 2, Link: '/fila' }],
      PriceRanges: [{ Name: 'de 0 a 50', Quantity: 1, Link: '/p/0-50' }],
      CategoriesTrees: [],
    });
    const provider = createLegacySearchProvider(client(vi.fn(), pub));
    const filters = await provider.facets({ term: 'sneaker', salesChannel: '1' });

    expect(filters.map((f) => f.key)).toEqual(['department', 'brand', 'priceRange']);
    expect(filters[1].values).toEqual([{ value: 'FILA', label: 'FILA', count: 2 }]);
    // An empty group contributes no filter rather than an empty one the storefront must skip.
    expect(filters.some((f) => f.key === 'category')).toBe(false);
  });

  it('requires the map parameter, whose absence is a 400 from VTEX', async () => {
    const pub = vi.fn().mockResolvedValue({});
    await createLegacySearchProvider(client(vi.fn(), pub)).facets({ term: 'x', salesChannel: '1' });
    expect(pub.mock.calls[0][1]).toContain('map=ft');
  });

  it('has no suggestions capability', () => {
    expect(createLegacySearchProvider(client(vi.fn())).suggestions).toBeUndefined();
  });
});
```

- [ ] **Step 5: Run it to verify it fails**

Run: `pnpm vitest run src/runtime/server/search/legacy.test.ts`
Expected: FAIL — cannot resolve `./legacy`.

- [ ] **Step 6: Write the adapter**

```ts
// src/runtime/server/search/legacy.ts
import type { AvailableFilter } from '@laioutr-core/orchestr/types';
import type { VtexClient } from '../client/types';
import type { SearchProvider } from './types';

interface LegacyProduct { productId: string }
interface LegacyFacetValue { Name: string; Quantity: number }
interface LegacyFacets {
  Departments?: LegacyFacetValue[];
  Brands?: LegacyFacetValue[];
  PriceRanges?: LegacyFacetValue[];
  CategoriesTrees?: LegacyFacetValue[];
}

/** `items 0-8/42` -> 42. */
const totalFromResources = (headers: Headers, fallback: number): number => {
  const match = /\/(\d+)\s*$/.exec(headers.get('resources') ?? '');
  return match ? Number(match[1]) : fallback;
};

const toFilter = (key: string, label: string, values?: LegacyFacetValue[]): AvailableFilter[] =>
  values?.length
    ? [{
        key, label, type: 'list',
        values: values.map((v) => ({ value: v.Name, label: v.Name, count: v.Quantity })),
      } as AvailableFilter]
    : [];

export const createLegacySearchProvider = (client: VtexClient): SearchProvider => ({
  id: 'legacy',

  async searchProducts({ term, categoryPath, from, to, salesChannel }) {
    const params = new URLSearchParams({ _from: String(from), _to: String(to), sc: salesChannel });
    if (term) params.set('ft', term);
    // `fq=skuId:` silently returns nothing; category filtering uses the C: path form.
    if (categoryPath) params.append('fq', `C:${categoryPath}`);

    const { data, headers } = await client.publicFetchRaw<LegacyProduct[]>(
      'catalogSystem',
      `/api/catalog_system/pub/products/search?${params}`
    );

    return {
      productIds: data.map((p) => p.productId),
      total: totalFromResources(headers, data.length),
    };
  },

  async facets({ term, categoryId, salesChannel }) {
    // `map` is mandatory — omitting it is answered with a 400, not an empty result.
    const path = categoryId
      ? `/api/catalog_system/pub/facets/category/${categoryId}?sc=${salesChannel}`
      : `/api/catalog_system/pub/facets/search/${encodeURIComponent(term ?? '')}?map=ft&sc=${salesChannel}`;

    const raw = await client.publicFetch<LegacyFacets>('catalogSystem', path);

    return [
      ...toFilter('department', 'Department', raw.Departments),
      ...toFilter('brand', 'Brand', raw.Brands),
      ...toFilter('priceRange', 'Price', raw.PriceRanges),
      ...toFilter('category', 'Category', raw.CategoriesTrees),
    ];
  },
});
```

- [ ] **Step 7: Run it to verify it passes**

Run: `pnpm vitest run src/runtime/server/search/legacy.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 8: Commit**

```bash
git add src/runtime/server/search/ src/runtime/server/client/
git commit -m "feat: add the search provider interface and legacy adapter"
```

---

## Task 8: Category tree helper

**Files:**
- Create: `src/runtime/server/vtex-helper/categoryTree.ts`
- Test: `src/runtime/server/vtex-helper/categoryTree.test.ts`

**Interfaces:**
- Consumes: `VtexClient` (Task 4).
- Produces:
  - `interface VtexCategoryNode { id: number; name: string; url: string; children: VtexCategoryNode[]; hasChildren: boolean }`
  - `slugFromUrl(url: string): string`
  - `flatten(nodes: VtexCategoryNode[]): VtexCategoryNode[]`
  - `findBySlug(nodes, slug): VtexCategoryNode | undefined`
  - `findById(nodes, id): VtexCategoryNode | undefined`
  - `ancestorsOf(nodes, id): VtexCategoryNode[]` — root-first, excluding the node itself
  - `categoryPathOf(nodes, id): string` — `'/2/3/'`
  - `loadCategoryTree(client: VtexClient): Promise<VtexCategoryNode[]>` — Nitro-cached

Breadcrumbs traverse this tree rather than issuing one request per ancestor. The tree is fetched once and shared by navigation, breadcrumbs, slug resolution and the listing page-index.

- [ ] **Step 1: Write the failing test**

```ts
// src/runtime/server/vtex-helper/categoryTree.test.ts
import { describe, expect, it } from 'vitest';
import { ancestorsOf, categoryPathOf, findById, findBySlug, flatten, slugFromUrl } from './categoryTree';
import type { VtexCategoryNode } from './categoryTree';

const node = (id: number, name: string, url: string, children: VtexCategoryNode[] = []): VtexCategoryNode =>
  ({ id, name, url, children, hasChildren: children.length > 0 });

const tree: VtexCategoryNode[] = [
  node(2, 'Damen', 'https://shop.example/damen', [
    node(3, 'Schuhe', 'https://shop.example/damen/schuhe', [
      node(4, 'Sneaker', 'https://shop.example/damen/schuhe/sneaker'),
    ]),
    node(7, 'Taschen', 'https://shop.example/damen/taschen'),
  ]),
];

describe('slugFromUrl', () => {
  it('takes the last path segment', () => {
    expect(slugFromUrl('https://shop.example/damen/schuhe/sneaker')).toBe('sneaker');
  });

  it('tolerates a trailing slash', () => {
    expect(slugFromUrl('https://shop.example/damen/')).toBe('damen');
  });
});

describe('flatten', () => {
  it('yields every node in the tree', () => {
    expect(flatten(tree).map((n) => n.id).sort()).toEqual([2, 3, 4, 7]);
  });
});

describe('findBySlug', () => {
  it('finds a nested category', () => {
    expect(findBySlug(tree, 'sneaker')?.id).toBe(4);
  });

  it('returns undefined for an unknown slug', () => {
    expect(findBySlug(tree, 'nope')).toBeUndefined();
  });
});

describe('ancestorsOf', () => {
  it('returns ancestors root-first, excluding the node', () => {
    expect(ancestorsOf(tree, 4).map((n) => n.id)).toEqual([2, 3]);
  });

  it('returns nothing for a root category', () => {
    expect(ancestorsOf(tree, 2)).toEqual([]);
  });
});

describe('categoryPathOf', () => {
  it('builds the VTEX category path used by fq=C:', () => {
    expect(categoryPathOf(tree, 4)).toBe('/2/3/4/');
  });

  it('handles a root category', () => {
    expect(categoryPathOf(tree, 2)).toBe('/2/');
  });

  it('returns an empty string for an unknown id', () => {
    expect(categoryPathOf(tree, 999)).toBe('');
  });
});

describe('findById', () => {
  it('finds a nested node', () => {
    expect(findById(tree, 7)?.name).toBe('Taschen');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run src/runtime/server/vtex-helper/categoryTree.test.ts`
Expected: FAIL — cannot resolve `./categoryTree`.

- [ ] **Step 3: Write the implementation**

```ts
// src/runtime/server/vtex-helper/categoryTree.ts
import { defineCachedFunction } from '#imports';
import type { VtexClient } from '../client/types';

export interface VtexCategoryNode {
  id: number;
  name: string;
  url: string;
  children: VtexCategoryNode[];
  hasChildren: boolean;
}

/** VTEX returns an absolute storefront URL; the storefront addresses categories by last segment. */
export const slugFromUrl = (url: string): string => {
  const path = url.replace(/\/+$/, '');
  return path.slice(path.lastIndexOf('/') + 1);
};

export const flatten = (nodes: VtexCategoryNode[]): VtexCategoryNode[] =>
  nodes.flatMap((n) => [n, ...flatten(n.children ?? [])]);

export const findBySlug = (nodes: VtexCategoryNode[], slug: string) =>
  flatten(nodes).find((n) => slugFromUrl(n.url) === slug);

export const findById = (nodes: VtexCategoryNode[], id: number) =>
  flatten(nodes).find((n) => n.id === id);

/** Walks the tree once rather than issuing a request per ancestor. */
export const ancestorsOf = (nodes: VtexCategoryNode[], id: number): VtexCategoryNode[] => {
  const walk = (current: VtexCategoryNode[], trail: VtexCategoryNode[]): VtexCategoryNode[] | undefined => {
    for (const n of current) {
      if (n.id === id) return trail;
      const hit = walk(n.children ?? [], [...trail, n]);
      if (hit) return hit;
    }
    return undefined;
  };
  return walk(nodes, []) ?? [];
};

export const categoryPathOf = (nodes: VtexCategoryNode[], id: number): string => {
  const node = findById(nodes, id);
  if (!node) return '';
  return `/${[...ancestorsOf(nodes, id), node].map((n) => n.id).join('/')}/`;
};

/**
 * Depth 5 covers every level this catalog uses. Cached for ten minutes: the tree changes rarely,
 * and VTEX offers no invalidation hook to key a shorter-lived cache off.
 */
export const loadCategoryTree = defineCachedFunction(
  async (client: VtexClient) =>
    client.publicFetch<VtexCategoryNode[]>('catalogSystem', '/api/catalog_system/pub/category/tree/5'),
  { maxAge: 600, name: 'vtex-category-tree', getKey: () => 'tree' }
);
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm vitest run src/runtime/server/vtex-helper/categoryTree.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/server/vtex-helper/categoryTree.ts src/runtime/server/vtex-helper/categoryTree.test.ts
git commit -m "feat: add category tree traversal helpers"
```

---

## Task 9: Category queries, links and resolver

**Files:**
- Create: `src/runtime/server/orchestr/category/all.query.ts`
- Create: `src/runtime/server/orchestr/category/bySlug.query.ts`
- Create: `src/runtime/server/orchestr/category/child-categories.link.ts`
- Create: `src/runtime/server/orchestr/category/breadcrumb.link.ts`
- Create: `src/runtime/server/orchestr/category/products.link.ts`
- Create: `src/runtime/server/orchestr/category/base.resolver.ts`
- Create: `src/runtime/server/vtex-helper/mappers/category.ts`
- Test: `src/runtime/server/vtex-helper/mappers/category.test.ts`

**Interfaces:**
- Consumes: `defineVtexQuery`/`defineVtexLink`/`defineVtexComponentResolver` (Task 6), tree helpers (Task 8), `createLegacySearchProvider` (Task 7).
- Produces: `toCategoryComponents(node, ancestors): { base, content, seo }` from the mapper, consumed by `base.resolver.ts` only.

Entity ids are the VTEX category id as a string.

- [ ] **Step 1: Write the failing mapper test**

```ts
// src/runtime/server/vtex-helper/mappers/category.test.ts
import { describe, expect, it } from 'vitest';
import { toCategoryComponents } from './category';

const node = { id: 4, name: 'Sneaker', url: 'https://shop.example/damen/schuhe/sneaker', children: [], hasChildren: false };

describe('toCategoryComponents', () => {
  it('maps identity and slug from the tree node', () => {
    const { base } = toCategoryComponents(node, []);
    expect(base).toEqual({ id: '4', name: 'Sneaker', slug: 'sneaker' });
  });

  it('derives the parent id from the nearest ancestor', () => {
    const { base } = toCategoryComponents(node, [{ ...node, id: 2 }, { ...node, id: 3 }]);
    expect(base.parentId).toBe('3');
  });

  it('leaves parentId undefined at the root', () => {
    expect(toCategoryComponents(node, []).base.parentId).toBeUndefined();
  });

  it('falls back to the category name for SEO when VTEX supplies no title', () => {
    expect(toCategoryComponents(node, []).seo.title).toBe('Sneaker');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run src/runtime/server/vtex-helper/mappers/category.test.ts`
Expected: FAIL — cannot resolve `./category`.

- [ ] **Step 3: Write the mapper**

```ts
// src/runtime/server/vtex-helper/mappers/category.ts
import { slugFromUrl, type VtexCategoryNode } from '../categoryTree';

export const toCategoryComponents = (node: VtexCategoryNode, ancestors: VtexCategoryNode[]) => ({
  base: {
    id: String(node.id),
    name: node.name,
    slug: slugFromUrl(node.url),
    ...(ancestors.length ? { parentId: String(ancestors[ancestors.length - 1].id) } : {}),
  },
  content: { title: node.name },
  // Freshly created categories often carry no meta at all, so the name is the honest fallback.
  seo: { title: node.name },
});
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm vitest run src/runtime/server/vtex-helper/mappers/category.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Write the queries and links**

```ts
// src/runtime/server/orchestr/category/all.query.ts
import { CategoryAllQuery } from '@laioutr-core/canonical-types/ecommerce';
import { defineVtexQuery } from '../../middleware/defineVtex';
import { flatten, loadCategoryTree } from '../../vtex-helper/categoryTree';

export default defineVtexQuery(CategoryAllQuery, async ({ context }) => ({
  ids: flatten(await loadCategoryTree(context.vtexClient)).map((n) => String(n.id)),
}));
```

```ts
// src/runtime/server/orchestr/category/bySlug.query.ts
import { CategoryBySlugQuery, CategoryNotFoundError } from '@laioutr-core/canonical-types/ecommerce';
import { defineVtexQuery } from '../../middleware/defineVtex';
import { findBySlug, loadCategoryTree } from '../../vtex-helper/categoryTree';

export default defineVtexQuery(CategoryBySlugQuery, async ({ context, input }) => {
  // Resolved from the cached tree — one fetch, versus one request per candidate category.
  const node = findBySlug(await loadCategoryTree(context.vtexClient), input.slug);
  if (!node) throw new CategoryNotFoundError(`No category for slug: ${input.slug}`);
  return { id: String(node.id) };
});
```

```ts
// src/runtime/server/orchestr/category/child-categories.link.ts
import { ChildCategoriesLink } from '@laioutr-core/canonical-types/ecommerce';
import { defineVtexLink } from '../../middleware/defineVtex';
import { findById, loadCategoryTree } from '../../vtex-helper/categoryTree';

export default defineVtexLink(ChildCategoriesLink, async ({ context, input }) => {
  const tree = await loadCategoryTree(context.vtexClient);
  return {
    links: Object.fromEntries(
      input.ids.map((id) => [id, (findById(tree, Number(id))?.children ?? []).map((c) => String(c.id))])
    ),
  };
});
```

```ts
// src/runtime/server/orchestr/category/breadcrumb.link.ts
import { CategoryBreadcrumbLink } from '@laioutr-core/canonical-types/ecommerce';
import { defineVtexLink } from '../../middleware/defineVtex';
import { ancestorsOf, loadCategoryTree } from '../../vtex-helper/categoryTree';

export default defineVtexLink(CategoryBreadcrumbLink, async ({ context, input }) => {
  const tree = await loadCategoryTree(context.vtexClient);
  return {
    links: Object.fromEntries(
      input.ids.map((id) => [id, ancestorsOf(tree, Number(id)).map((n) => String(n.id))])
    ),
  };
});
```

```ts
// src/runtime/server/orchestr/category/products.link.ts
import { CategoryProductsLink } from '@laioutr-core/canonical-types/ecommerce';
import { defineVtexLink } from '../../middleware/defineVtex';
import { createLegacySearchProvider } from '../../search/legacy';
import { categoryPathOf, loadCategoryTree } from '../../vtex-helper/categoryTree';

export default defineVtexLink(CategoryProductsLink, async ({ context, input }) => {
  const provider = createLegacySearchProvider(context.vtexClient);
  const tree = await loadCategoryTree(context.vtexClient);

  const entries = await Promise.all(
    input.ids.map(async (id) => {
      const { productIds } = await provider.searchProducts({
        categoryPath: categoryPathOf(tree, Number(id)),
        from: 0, to: 49,
        salesChannel: context.vtexSalesChannel,
      });
      return [id, productIds] as const;
    })
  );

  return { links: Object.fromEntries(entries) };
});
```

- [ ] **Step 6: Write the resolver**

```ts
// src/runtime/server/orchestr/category/base.resolver.ts
import { CategoryBase, CategoryContent, CategorySeo } from '@laioutr-core/canonical-types/entity/category';
import { defineVtexComponentResolver } from '../../middleware/defineVtex';
import { toCategoryComponents } from '../../vtex-helper/mappers/category';
import { ancestorsOf, findById, loadCategoryTree } from '../../vtex-helper/categoryTree';

export default defineVtexComponentResolver({
  label: 'VTEX Category Connector',
  entityType: 'Category',
  provides: [CategoryBase, CategoryContent, CategorySeo],
  resolve: async ({ entityIds, context, $entity }) => {
    const tree = await loadCategoryTree(context.vtexClient);

    return entityIds.map((id) => {
      const node = findById(tree, Number(id));
      if (!node) return $entity(id, {});

      const { base, content, seo } = toCategoryComponents(node, ancestorsOf(tree, Number(id)));
      return $entity(id, {
        [CategoryBase.name]: base,
        [CategoryContent.name]: content,
        [CategorySeo.name]: seo,
      });
    });
  },
});
```

- [ ] **Step 7: Verify the module builds and the handlers register**

Run: `pnpm run dev:prepare && pnpm run lint && pnpm test`
Expected: build and lint clean, all suites pass.

- [ ] **Step 8: Verify against the live account**

Run:
```bash
source .env
curl -s "https://$VTEX_ACCOUNT_NAME.$VTEX_ENVIRONMENT.com.br/api/catalog_system/pub/category/tree/5" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print('top-level:', [c['name'] for c in d])"
```
Expected: `Damen` and `Taschen` at minimum, confirming the tree the handlers traverse.

- [ ] **Step 9: Commit**

```bash
git add src/runtime/server/orchestr/category/ src/runtime/server/vtex-helper/mappers/
git commit -m "feat: add category queries, links and resolver"
```

---

## Task 10: Menu

**Files:**
- Create: `src/runtime/server/orchestr/menu/byAlias.query.ts`
- Create: `src/runtime/server/orchestr/menu/base.resolver.ts`

**Interfaces:**
- Consumes: tree helpers (Task 8), `defineVtexQuery`/`defineVtexComponentResolver` (Task 6).
- Produces: nothing other tasks import.

VTEX has no menu entity. The navigation menu is the category tree, so an alias selects a subtree root: `main` is the whole tree, any other alias is matched against a category slug.

- [ ] **Step 1: Write the query**

```ts
// src/runtime/server/orchestr/menu/byAlias.query.ts
import { MenuByAliasQuery } from '@laioutr-core/canonical-types/ecommerce';
import { defineVtexQuery } from '../../middleware/defineVtex';
import { findBySlug, loadCategoryTree } from '../../vtex-helper/categoryTree';

export default defineVtexQuery(MenuByAliasQuery, async ({ context, input }) => {
  // VTEX has no menu entity; a menu is a subtree of the category tree. `main` is the whole tree.
  if (input.alias === 'main') return { id: 'main' };

  const node = findBySlug(await loadCategoryTree(context.vtexClient), input.alias);
  return { id: node ? String(node.id) : 'main' };
});
```

- [ ] **Step 2: Write the resolver**

```ts
// src/runtime/server/orchestr/menu/base.resolver.ts
import { MenuItemBase } from '@laioutr-core/canonical-types/entity/menuItem';
import { defineVtexComponentResolver } from '../../middleware/defineVtex';
import { findById, loadCategoryTree, slugFromUrl } from '../../vtex-helper/categoryTree';

export default defineVtexComponentResolver({
  label: 'VTEX Menu Connector',
  entityType: 'MenuItem',
  provides: [MenuItemBase],
  resolve: async ({ entityIds, context, $entity }) => {
    const tree = await loadCategoryTree(context.vtexClient);

    return entityIds.map((id) => {
      const node = id === 'main' ? undefined : findById(tree, Number(id));
      return $entity(id, {
        [MenuItemBase.name]: {
          id,
          label: node?.name ?? 'Main',
          url: node ? `/${slugFromUrl(node.url)}` : '/',
        },
      });
    });
  },
});
```

- [ ] **Step 3: Verify and commit**

Run: `pnpm run dev:prepare && pnpm run lint`
Expected: clean. Then:

```bash
git add src/runtime/server/orchestr/menu/
git commit -m "feat: add menu query and resolver"
```

> **If `MenuItemBase` is not exported from `@laioutr-core/canonical-types/entity/menuItem`,** list the real exports with
> `node -e "console.log(Object.keys(require('@laioutr-core/canonical-types/entity/menuItem')))"`
> and use the component names it reports. Do not invent a token.

---

## Task 11: Product mapper and resolver

**Files:**
- Create: `src/runtime/server/vtex-helper/mappers/product.ts`
- Create: `src/runtime/server/orchestr/product/base.resolver.ts`
- Create: `src/runtime/server/const/passthroughTokens.ts`
- Test: `src/runtime/server/vtex-helper/mappers/product.test.ts`

**Interfaces:**
- Consumes: `fromDecimal` (Task 2), `defineVtexComponentResolver` (Task 6).
- Produces:
  - `interface VtexProduct` — the Legacy Search product shape
  - `toProductComponents(p: VtexProduct, currency: string)` returning `{ base, info, description, media, prices, seo, brand, specifications }`
  - `loadedProductsToken` — a `PassthroughToken<VtexProduct[]>` so a query can hand already-fetched products to the resolver

`ProductRating` is deliberately not provided: it comes from the reviews API, which is out of this round. Declaring a component the resolver cannot fill fails at request time rather than at registration.

- [ ] **Step 1: Write the failing test**

```ts
// src/runtime/server/vtex-helper/mappers/product.test.ts
import { describe, expect, it } from 'vitest';
import { toProductComponents, type VtexProduct } from './product';

const product: VtexProduct = {
  productId: '146835',
  productName: 'Slip On Sneaker',
  linkText: 'slip-on-sneaker',
  description: 'A shoe.',
  brand: 'FILA',
  categories: ['/Damen/Schuhe/Sneaker/', '/Damen/Schuhe/'],
  items: [
    {
      itemId: '146835',
      name: 'FILA Slip On Sneaker',
      images: [{ imageUrl: 'https://cdn.example/a.jpg', imageText: 'front' }],
      sellers: [{ commertialOffer: { Price: 49.99, ListPrice: 59.99, AvailableQuantity: 100 } }],
    },
  ],
};

describe('toProductComponents', () => {
  it('maps identity using linkText as the slug', () => {
    // LinkId casing differs from linkText and does not resolve; linkText is the addressable slug.
    expect(toProductComponents(product, 'EUR').base).toEqual({
      id: '146835', name: 'Slip On Sneaker', slug: 'slip-on-sneaker',
    });
  });

  it('converts decimal prices into minor units', () => {
    const { prices } = toProductComponents(product, 'EUR');
    expect(prices.price).toEqual({ amount: 4999, currency: 'EUR' });
    expect(prices.listPrice).toEqual({ amount: 5999, currency: 'EUR' });
  });

  it('omits listPrice when it does not exceed the price', () => {
    const flat = { ...product, items: [{ ...product.items[0],
      sellers: [{ commertialOffer: { Price: 49.99, ListPrice: 49.99, AvailableQuantity: 1 } }] }] };
    expect(toProductComponents(flat, 'EUR').prices.listPrice).toBeUndefined();
  });

  it('maps every image', () => {
    expect(toProductComponents(product, 'EUR').media.images).toEqual([
      { url: 'https://cdn.example/a.jpg', alt: 'front' },
    ]);
  });

  it('survives a product with no sellers rather than throwing', () => {
    const orphan = { ...product, items: [{ ...product.items[0], sellers: [] }] };
    expect(toProductComponents(orphan, 'EUR').prices.price).toBeUndefined();
  });

  it('carries the brand', () => {
    expect(toProductComponents(product, 'EUR').brand).toEqual({ name: 'FILA' });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run src/runtime/server/vtex-helper/mappers/product.test.ts`
Expected: FAIL — cannot resolve `./product`.

- [ ] **Step 3: Write the mapper**

```ts
// src/runtime/server/vtex-helper/mappers/product.ts
import { fromDecimal } from '../money';

export interface VtexCommertialOffer {
  Price: number;
  ListPrice: number | null;
  AvailableQuantity: number;
}

export interface VtexItem {
  itemId: string;
  name: string;
  images?: { imageUrl: string; imageText?: string }[];
  sellers?: { commertialOffer: VtexCommertialOffer }[];
  variations?: Record<string, string[]>;
}

export interface VtexProduct {
  productId: string;
  productName: string;
  linkText: string;
  description?: string;
  brand?: string;
  categories?: string[];
  items: VtexItem[];
}

const offerOf = (p: VtexProduct): VtexCommertialOffer | undefined =>
  p.items?.[0]?.sellers?.[0]?.commertialOffer;

export const toProductComponents = (p: VtexProduct, currency: string) => {
  const offer = offerOf(p);
  const price = offer ? fromDecimal(offer.Price, currency) : undefined;
  // VTEX repeats the price in ListPrice when nothing is discounted; a struck-through equal price
  // is noise, so only a genuinely higher list price is carried through.
  const list = offer?.ListPrice && offer.ListPrice > offer.Price
    ? fromDecimal(offer.ListPrice, currency)
    : undefined;

  return {
    base: { id: p.productId, name: p.productName, slug: p.linkText },
    info: { name: p.productName },
    description: { description: p.description ?? '' },
    media: {
      images: (p.items?.[0]?.images ?? []).map((i) => ({ url: i.imageUrl, alt: i.imageText ?? '' })),
    },
    prices: {
      ...(price ? { price: { amount: price.getAmount(), currency: price.getCurrency() } } : {}),
      ...(list ? { listPrice: { amount: list.getAmount(), currency: list.getCurrency() } } : {}),
    },
    seo: { title: p.productName },
    brand: p.brand ? { name: p.brand } : undefined,
    specifications: { specifications: [] },
  };
};
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm vitest run src/runtime/server/vtex-helper/mappers/product.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Add the passthrough token**

```ts
// src/runtime/server/const/passthroughTokens.ts
import { definePassthroughToken } from '#imports';
import type { VtexProduct } from '../vtex-helper/mappers/product';

/**
 * A query that already fetched full products hands them to the resolver here, so the resolver does
 * not refetch what the caller just read. Product detail otherwise costs one request per component.
 */
export const loadedProductsToken = definePassthroughToken<VtexProduct[]>('vtex:loaded-products');
```

> **If `definePassthroughToken` is not exported from `#imports`,** find the real factory with
> `grep -rn "PassthroughToken" node_modules/@laioutr-core/orchestr/dist/runtime/types/userland/PassthroughToken.d.ts`
> and follow how `app-shopware/src/runtime/server/const/passthroughTokens.ts` constructs its tokens.

- [ ] **Step 6: Write the resolver**

```ts
// src/runtime/server/orchestr/product/base.resolver.ts
import {
  ProductBase, ProductBrand, ProductDescription, ProductInfo,
  ProductMedia, ProductPrices, ProductSeo, ProductSpecifications,
} from '@laioutr-core/canonical-types/entity/product';
import { defineVtexComponentResolver } from '../../middleware/defineVtex';
import { loadedProductsToken } from '../../const/passthroughTokens';
import { toProductComponents, type VtexProduct } from '../../vtex-helper/mappers/product';

export default defineVtexComponentResolver({
  label: 'VTEX Product Connector',
  entityType: 'Product',
  // ProductRating is absent on purpose: it comes from the reviews API, which is not in this round.
  provides: [
    ProductBase, ProductInfo, ProductDescription, ProductMedia,
    ProductPrices, ProductSeo, ProductBrand, ProductSpecifications,
  ],
  resolve: async ({ entityIds, context, clientEnv, passthrough, $entity }) => {
    const preloaded = passthrough.get(loadedProductsToken) ?? [];
    const missing = entityIds.filter((id) => !preloaded.some((p) => p.productId === id));

    const fetched = missing.length
      ? await context.vtexClient.publicFetch<VtexProduct[]>(
          'catalogSystem',
          `/api/catalog_system/pub/products/search?${new URLSearchParams([
            ...missing.map((id) => ['fq', `productId:${id}`]),
            ['sc', context.vtexSalesChannel],
          ])}`
        )
      : [];

    const all = [...preloaded, ...fetched];
    const currency = clientEnv.market.currency;

    return entityIds.map((id) => {
      const product = all.find((p) => p.productId === id);
      if (!product) return $entity(id, {});

      const c = toProductComponents(product, currency);
      return $entity(id, {
        [ProductBase.name]: c.base,
        [ProductInfo.name]: c.info,
        [ProductDescription.name]: c.description,
        [ProductMedia.name]: c.media,
        [ProductPrices.name]: c.prices,
        [ProductSeo.name]: c.seo,
        [ProductSpecifications.name]: c.specifications,
        ...(c.brand ? { [ProductBrand.name]: c.brand } : {}),
      });
    });
  },
});
```

- [ ] **Step 7: Verify and commit**

Run: `pnpm run dev:prepare && pnpm run lint && pnpm test`
Expected: clean.

```bash
git add src/runtime/server/vtex-helper/mappers/product.ts src/runtime/server/vtex-helper/mappers/product.test.ts src/runtime/server/orchestr/product/base.resolver.ts src/runtime/server/const/
git commit -m "feat: add product mapper and resolver"
```

---

## Task 12: Product queries and links

**Files:**
- Create: `src/runtime/server/orchestr/product/bySlug.query.ts`
- Create: `src/runtime/server/orchestr/product/byCategoryId.query.ts`
- Create: `src/runtime/server/orchestr/product/byCategorySlug.query.ts`
- Create: `src/runtime/server/orchestr/product/search.query.ts`
- Create: `src/runtime/server/orchestr/product/variants.link.ts`
- Create: `src/runtime/server/orchestr/product/breadcrumb.link.ts`
- Create: `src/runtime/server/orchestr/product/all-categories.link.ts`

**Interfaces:**
- Consumes: `defineVtexQuery`/`defineVtexLink` (Task 6), `createLegacySearchProvider` (Task 7), tree helpers (Task 8), `loadedProductsToken` and `VtexProduct` (Task 11).
- Produces: nothing other tasks import.

- [ ] **Step 1: Write `bySlug.query.ts`**

```ts
import { ProductBySlugQuery, ProductNotFoundError } from '@laioutr-core/canonical-types/ecommerce';
import { defineVtexQuery } from '../../middleware/defineVtex';
import { loadedProductsToken } from '../../const/passthroughTokens';
import type { VtexProduct } from '../../vtex-helper/mappers/product';

export default defineVtexQuery(ProductBySlugQuery, async ({ context, input, passthrough }) => {
  const found = await context.vtexClient.publicFetch<VtexProduct[]>(
    'catalogSystem',
    `/api/catalog_system/pub/products/search/${encodeURIComponent(input.slug)}/p?sc=${context.vtexSalesChannel}`
  );

  // An unknown slug yields an empty list rather than a 404, so absence is the only signal.
  const product = found[0];
  if (!product) throw new ProductNotFoundError(`No product for slug: ${input.slug}`);

  // The resolver would otherwise refetch what we just read.
  passthrough.set(loadedProductsToken, found);

  return { id: product.productId };
});
```

- [ ] **Step 2: Write `search.query.ts`**

```ts
import { ProductSearchQuery } from '@laioutr-core/canonical-types/ecommerce';
import { defineVtexQuery } from '../../middleware/defineVtex';
import { createLegacySearchProvider } from '../../search/legacy';

export default defineVtexQuery(ProductSearchQuery, async ({ context, input }) => {
  const { productIds, total } = await createLegacySearchProvider(context.vtexClient).searchProducts({
    term: input.query,
    from: 0,
    to: 49,
    salesChannel: context.vtexSalesChannel,
  });
  return { ids: productIds, total };
});
```

- [ ] **Step 3: Write `byCategoryId.query.ts` and `byCategorySlug.query.ts`**

```ts
// byCategoryId.query.ts
import { ProductsByCategoryIdQuery } from '@laioutr-core/canonical-types/ecommerce';
import { defineVtexQuery } from '../../middleware/defineVtex';
import { createLegacySearchProvider } from '../../search/legacy';
import { categoryPathOf, loadCategoryTree } from '../../vtex-helper/categoryTree';

export default defineVtexQuery(ProductsByCategoryIdQuery, async ({ context, input }) => {
  const tree = await loadCategoryTree(context.vtexClient);
  const { productIds, total } = await createLegacySearchProvider(context.vtexClient).searchProducts({
    categoryPath: categoryPathOf(tree, Number(input.categoryId)),
    from: 0, to: 49,
    salesChannel: context.vtexSalesChannel,
  });
  return { ids: productIds, total };
});
```

```ts
// byCategorySlug.query.ts
import { CategoryNotFoundError, ProductsByCategorySlugQuery } from '@laioutr-core/canonical-types/ecommerce';
import { defineVtexQuery } from '../../middleware/defineVtex';
import { createLegacySearchProvider } from '../../search/legacy';
import { categoryPathOf, findBySlug, loadCategoryTree } from '../../vtex-helper/categoryTree';

export default defineVtexQuery(ProductsByCategorySlugQuery, async ({ context, input }) => {
  const tree = await loadCategoryTree(context.vtexClient);
  const node = findBySlug(tree, input.slug);
  if (!node) throw new CategoryNotFoundError(`No category for slug: ${input.slug}`);

  const { productIds, total } = await createLegacySearchProvider(context.vtexClient).searchProducts({
    categoryPath: categoryPathOf(tree, node.id),
    from: 0, to: 49,
    salesChannel: context.vtexSalesChannel,
  });
  return { ids: productIds, total };
});
```

- [ ] **Step 4: Write the three links**

```ts
// variants.link.ts — a VTEX SKU is a canonical ProductVariant.
import { ProductVariantsLink } from '@laioutr-core/canonical-types/ecommerce';
import { defineVtexLink } from '../../middleware/defineVtex';
import type { VtexProduct } from '../../vtex-helper/mappers/product';

export default defineVtexLink(ProductVariantsLink, async ({ context, input }) => {
  const products = await context.vtexClient.publicFetch<VtexProduct[]>(
    'catalogSystem',
    `/api/catalog_system/pub/products/search?${new URLSearchParams([
      ...input.ids.map((id) => ['fq', `productId:${id}`]),
      ['sc', context.vtexSalesChannel],
    ])}`
  );

  return {
    links: Object.fromEntries(
      input.ids.map((id) => [
        id,
        (products.find((p) => p.productId === id)?.items ?? []).map((i) => i.itemId),
      ])
    ),
  };
});
```

```ts
// all-categories.link.ts
import { ProductAllCategoriesLink } from '@laioutr-core/canonical-types/ecommerce';
import { defineVtexLink } from '../../middleware/defineVtex';
import { findBySlug, loadCategoryTree, slugFromUrl } from '../../vtex-helper/categoryTree';
import type { VtexProduct } from '../../vtex-helper/mappers/product';

/** VTEX returns category *paths* like '/Damen/Schuhe/'; the tree turns the leaf name into an id. */
const leafSlug = (path: string) => {
  const parts = path.split('/').filter(Boolean);
  return parts[parts.length - 1]?.toLowerCase().replace(/\s+/g, '-') ?? '';
};

export default defineVtexLink(ProductAllCategoriesLink, async ({ context, input }) => {
  const tree = await loadCategoryTree(context.vtexClient);
  const products = await context.vtexClient.publicFetch<VtexProduct[]>(
    'catalogSystem',
    `/api/catalog_system/pub/products/search?${new URLSearchParams([
      ...input.ids.map((id) => ['fq', `productId:${id}`]),
      ['sc', context.vtexSalesChannel],
    ])}`
  );

  return {
    links: Object.fromEntries(
      input.ids.map((id) => {
        const paths = products.find((p) => p.productId === id)?.categories ?? [];
        const ids = paths
          .map((path) => findBySlug(tree, leafSlug(path))?.id)
          .filter((v): v is number => v !== undefined)
          .map(String);
        return [id, [...new Set(ids)]];
      })
    ),
  };
});
```

```ts
// breadcrumb.link.ts — the deepest category path, walked through the tree.
import { ProductBreadcrumbLink } from '@laioutr-core/canonical-types/ecommerce';
import { defineVtexLink } from '../../middleware/defineVtex';
import { ancestorsOf, findBySlug, loadCategoryTree } from '../../vtex-helper/categoryTree';
import type { VtexProduct } from '../../vtex-helper/mappers/product';

const leafSlug = (path: string) => {
  const parts = path.split('/').filter(Boolean);
  return parts[parts.length - 1]?.toLowerCase().replace(/\s+/g, '-') ?? '';
};

export default defineVtexLink(ProductBreadcrumbLink, async ({ context, input }) => {
  const tree = await loadCategoryTree(context.vtexClient);
  const products = await context.vtexClient.publicFetch<VtexProduct[]>(
    'catalogSystem',
    `/api/catalog_system/pub/products/search?${new URLSearchParams([
      ...input.ids.map((id) => ['fq', `productId:${id}`]),
      ['sc', context.vtexSalesChannel],
    ])}`
  );

  return {
    links: Object.fromEntries(
      input.ids.map((id) => {
        // VTEX lists the deepest path first.
        const deepest = products.find((p) => p.productId === id)?.categories?.[0];
        const node = deepest ? findBySlug(tree, leafSlug(deepest)) : undefined;
        if (!node) return [id, []];
        return [id, [...ancestorsOf(tree, node.id), node].map((n) => String(n.id))];
      })
    ),
  };
});
```

- [ ] **Step 5: Verify against the live account**

Run: `pnpm run dev:prepare && pnpm run lint && pnpm test`, then:
```bash
source .env
curl -s "https://$VTEX_ACCOUNT_NAME.$VTEX_ENVIRONMENT.com.br/api/catalog_system/pub/products/search/slip-on-sneaker/p?sc=1" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(d[0]['productName'], d[0]['linkText'])"
```
Expected: `Slip On Sneaker slip-on-sneaker` — the exact path `bySlug.query.ts` calls.

- [ ] **Step 6: Commit**

```bash
git add src/runtime/server/orchestr/product/
git commit -m "feat: add product queries and links"
```

---

## Task 13: ProductVariant resolver

**Files:**
- Create: `src/runtime/server/orchestr/product-variant/base.resolver.ts`

**Interfaces:**
- Consumes: `defineVtexComponentResolver` (Task 6), `fromDecimal` (Task 2), `VtexProduct` (Task 11).
- Produces: nothing other tasks import.

Entity ids are VTEX SKU ids (`itemId`). A SKU is only reachable through its parent product, so the resolver searches by SKU id and picks the matching item out of the returned product.

- [ ] **Step 1: Write the resolver**

```ts
// src/runtime/server/orchestr/product-variant/base.resolver.ts
import {
  ProductVariantAvailability, ProductVariantBase,
  ProductVariantInfo, ProductVariantOptions, ProductVariantPrices,
} from '@laioutr-core/canonical-types/entity/product-variant';
import { defineVtexComponentResolver } from '../../middleware/defineVtex';
import { fromDecimal } from '../../vtex-helper/money';
import type { VtexProduct } from '../../vtex-helper/mappers/product';

export default defineVtexComponentResolver({
  label: 'VTEX Product Variant Connector',
  entityType: 'ProductVariant',
  provides: [
    ProductVariantBase, ProductVariantInfo,
    ProductVariantPrices, ProductVariantOptions, ProductVariantAvailability,
  ],
  resolve: async ({ entityIds, context, clientEnv, $entity }) => {
    // A SKU is addressable only through its product, so this searches by sku and reads the item back.
    const products = await context.vtexClient.publicFetch<VtexProduct[]>(
      'catalogSystem',
      `/api/catalog_system/pub/products/search?${new URLSearchParams([
        ...entityIds.map((id) => ['fq', `skuId:${id}`]),
        ['sc', context.vtexSalesChannel],
      ])}`
    );

    const items = products.flatMap((p) => p.items.map((i) => ({ item: i, product: p })));
    const currency = clientEnv.market.currency;

    return entityIds.map((id) => {
      const hit = items.find((x) => x.item.itemId === id);
      if (!hit) return $entity(id, {});

      const offer = hit.item.sellers?.[0]?.commertialOffer;
      const price = offer ? fromDecimal(offer.Price, currency) : undefined;

      return $entity(id, {
        [ProductVariantBase.name]: { id, productId: hit.product.productId, sku: id },
        [ProductVariantInfo.name]: { name: hit.item.name },
        [ProductVariantPrices.name]: price
          ? { price: { amount: price.getAmount(), currency: price.getCurrency() } }
          : {},
        [ProductVariantOptions.name]: {
          options: Object.entries(hit.item.variations ?? {}).map(([name, values]) => ({
            name, value: values[0] ?? '',
          })),
        },
        [ProductVariantAvailability.name]: {
          available: (offer?.AvailableQuantity ?? 0) > 0,
          stock: offer?.AvailableQuantity ?? 0,
        },
      });
    });
  },
});
```

> **`fq=skuId:` does not filter on the catalog search used elsewhere in this plan.** It is used here
> only because `products/search` accepts it as a *lookup* alongside `fq=productId:`. Verify at Step 2;
> if it returns empty, fall back to `GET /api/catalog_system/pvt/sku/stockkeepingunitbyid/{skuId}`
> with `adminFetch` and map from that shape instead.

- [ ] **Step 2: Verify the SKU lookup actually returns data**

Run:
```bash
source .env
curl -s "https://$VTEX_ACCOUNT_NAME.$VTEX_ENVIRONMENT.com.br/api/catalog_system/pub/products/search?fq=skuId:146835&sc=1" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d), 'products')"
```
Expected: `1 products`. **If it prints `0`, take the fallback in the note above before continuing** — this is exactly the trap recorded in the environment notes.

- [ ] **Step 3: Verify and commit**

Run: `pnpm run dev:prepare && pnpm run lint && pnpm test`

```bash
git add src/runtime/server/orchestr/product-variant/
git commit -m "feat: add product variant resolver"
```

---

## Task 14: Page-indexes

**Files:**
- Create: `src/runtime/server/vtex-helper/pageIndexEntries.ts`
- Create: `src/runtime/server/orchestr/product/detail-page.page-index.ts`
- Create: `src/runtime/server/orchestr/category/listing-page.page-index.ts`
- Create: `src/runtime/server/orchestr/product/search-page.page-index.ts`
- Test: `src/runtime/server/vtex-helper/pageIndexEntries.test.ts`

**Interfaces:**
- Consumes: `defineVtexPageIndex` (Task 6), tree helpers (Task 8), `VtexProduct` (Task 11).
- Produces: `toProductPageEntry(p: VtexProduct)` and `toCategoryPageEntry(node)`.

Without a page-index there are no PDP or PLP URLs at all. Enumeration uses `GetProductAndSkuIds` with `adminFetch` — an unfiltered `products/search` returns nothing, so it cannot serve as a catalog dump.

- [ ] **Step 1: Write the failing entry-mapper test**

```ts
// src/runtime/server/vtex-helper/pageIndexEntries.test.ts
import { describe, expect, it } from 'vitest';
import { toCategoryPageEntry, toProductPageEntry } from './pageIndexEntries';

describe('toProductPageEntry', () => {
  it('keys the entry on linkText, the addressable slug', () => {
    expect(toProductPageEntry({
      productId: '1', productName: 'Runner Low', linkText: 'runner-low', items: [],
    })).toEqual({ params: { slug: 'runner-low' }, meta: { title: 'Runner Low' } });
  });

  it('carries the first image as the preview when present', () => {
    const entry = toProductPageEntry({
      productId: '1', productName: 'Runner Low', linkText: 'runner-low',
      items: [{ itemId: '1', name: 'Runner Low', images: [{ imageUrl: 'https://cdn/x.jpg' }] }],
    });
    expect(entry.meta.previewImage).toBe('https://cdn/x.jpg');
  });
});

describe('toCategoryPageEntry', () => {
  it('keys the entry on the category slug', () => {
    expect(toCategoryPageEntry({
      id: 4, name: 'Sneaker', url: 'https://shop.example/damen/schuhe/sneaker',
      children: [], hasChildren: false,
    })).toEqual({ params: { slug: 'sneaker' }, meta: { title: 'Sneaker' } });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run src/runtime/server/vtex-helper/pageIndexEntries.test.ts`
Expected: FAIL — cannot resolve `./pageIndexEntries`.

- [ ] **Step 3: Write the entry mappers**

```ts
// src/runtime/server/vtex-helper/pageIndexEntries.ts
import { slugFromUrl, type VtexCategoryNode } from './categoryTree';
import type { VtexProduct } from './mappers/product';

export const toProductPageEntry = (p: VtexProduct) => ({
  // linkText, never LinkId: the casing differs and only linkText resolves.
  params: { slug: p.linkText },
  meta: {
    title: p.productName,
    ...(p.items?.[0]?.images?.[0]?.imageUrl ? { previewImage: p.items[0].images![0].imageUrl } : {}),
  },
});

export const toCategoryPageEntry = (n: VtexCategoryNode) => ({
  params: { slug: slugFromUrl(n.url) },
  meta: { title: n.name },
});
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm vitest run src/runtime/server/vtex-helper/pageIndexEntries.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Write the product detail page-index**

```ts
// src/runtime/server/orchestr/product/detail-page.page-index.ts
import { ProductDetailPage } from '@laioutr-core/canonical-types/ecommerce';
import { defineVtexPageIndex } from '../../middleware/defineVtex';
import { toProductPageEntry } from '../../vtex-helper/pageIndexEntries';
import type { VtexProduct } from '../../vtex-helper/mappers/product';

/** `GetProductAndSkuIds` is the only way to enumerate: an unfiltered search returns nothing. */
const listProductIds = async (
  adminFetch: (api: 'catalogSystem', path: string) => Promise<unknown>,
  from: number, to: number
) => {
  const res = (await adminFetch(
    'catalogSystem',
    `/api/catalog_system/pvt/products/GetProductAndSkuIds?_from=${from}&_to=${to}`
  )) as { data: Record<string, number[]>; range: { total: number } };
  return { ids: Object.keys(res.data), total: res.range.total };
};

export default defineVtexPageIndex({
  for: ProductDetailPage,
  label: 'VTEX Product',
  batchSize: 50,
  cache: { ttl: '1h', search: { ttl: '5m' }, locate: { ttl: '1 day' } },

  locate: async ({ context, params }) => {
    const found = await context.vtexClient.publicFetch<VtexProduct[]>(
      'catalogSystem',
      `/api/catalog_system/pub/products/search/${encodeURIComponent(params.slug)}/p?sc=${context.vtexSalesChannel}`
    );
    // A miss is an empty list, not a 404.
    return found[0] ? { id: found[0].productId, meta: toProductPageEntry(found[0]).meta } : undefined;
  },

  count: async ({ context }) =>
    (await listProductIds(context.vtexClient.adminFetch, 1, 1)).total,

  search: async ({ context, term, take }) => {
    const found = await context.vtexClient.publicFetch<VtexProduct[]>(
      'catalogSystem',
      `/api/catalog_system/pub/products/search?ft=${encodeURIComponent(term)}&_from=0&_to=${take - 1}&sc=${context.vtexSalesChannel}`
    );
    return found.map(toProductPageEntry);
  },

  list: async ({ context, batchSize, startCursor }) => {
    const from = Number(startCursor ?? 1);
    const { ids, total } = await listProductIds(context.vtexClient.adminFetch, from, from + batchSize - 1);
    if (!ids.length) return { entries: [], nextCursor: undefined };

    const products = await context.vtexClient.publicFetch<VtexProduct[]>(
      'catalogSystem',
      `/api/catalog_system/pub/products/search?${new URLSearchParams([
        ...ids.map((id) => ['fq', `productId:${id}`]),
        ['sc', context.vtexSalesChannel],
      ])}`
    );

    const next = from + batchSize;
    return {
      entries: products.map(toProductPageEntry),
      nextCursor: next <= total ? String(next) : undefined,
    };
  },
});
```

- [ ] **Step 6: Write the listing and search page-indexes**

```ts
// src/runtime/server/orchestr/category/listing-page.page-index.ts
import { ProductListingPage } from '@laioutr-core/canonical-types/ecommerce';
import { defineVtexPageIndex } from '../../middleware/defineVtex';
import { toCategoryPageEntry } from '../../vtex-helper/pageIndexEntries';
import { findBySlug, flatten, loadCategoryTree } from '../../vtex-helper/categoryTree';

/** The whole tree arrives in one cached request, so listing pages need no pagination. */
export default defineVtexPageIndex({
  for: ProductListingPage,
  label: 'VTEX Category',
  batchSize: 500,
  cache: { ttl: '1h', search: { ttl: '10m' }, locate: { ttl: '1h' } },

  locate: async ({ context, params }) => {
    const node = findBySlug(await loadCategoryTree(context.vtexClient), params.slug);
    return node ? { id: String(node.id), meta: toCategoryPageEntry(node).meta } : undefined;
  },

  count: async ({ context }) => flatten(await loadCategoryTree(context.vtexClient)).length,

  search: async ({ context, term, take }) =>
    flatten(await loadCategoryTree(context.vtexClient))
      .filter((n) => n.name.toLowerCase().includes(term.toLowerCase()))
      .slice(0, take)
      .map(toCategoryPageEntry),

  list: async ({ context }) => ({
    entries: flatten(await loadCategoryTree(context.vtexClient)).map(toCategoryPageEntry),
    nextCursor: undefined,
  }),
});
```

```ts
// src/runtime/server/orchestr/product/search-page.page-index.ts
import { ProductSearchPage } from '@laioutr-core/canonical-types/ecommerce';
import { defineVtexPageIndex } from '../../middleware/defineVtex';

/**
 * The search page is a single route whose term is a query parameter, not a page per term — so it
 * enumerates exactly one entry and locates unconditionally.
 */
export default defineVtexPageIndex({
  for: ProductSearchPage,
  label: 'VTEX Search',
  batchSize: 1,
  cache: { ttl: '1 day' },
  locate: async () => ({ id: 'search', meta: { title: 'Search' } }),
  count: async () => 1,
  search: async () => [],
  list: async () => ({ entries: [{ params: {}, meta: { title: 'Search' } }], nextCursor: undefined }),
});
```

> **The page-index registration shape is the least certain part of this plan.** Before writing these,
> read `app-shopware/src/runtime/server/orchestr/product/detail-page.page-index.ts` and
> `category/listing-page.page-index.ts` and match their exact `locate`/`list` return shapes and their
> use of `paginate` from `#imports`. Where this plan and that working code disagree, the working code wins.

- [ ] **Step 7: Verify enumeration works against the account**

Run:
```bash
source .env
curl -s -H "X-VTEX-API-AppKey: $VTEX_APP_KEY" -H "X-VTEX-API-AppToken: $VTEX_APP_TOKEN" \
  "https://$VTEX_ACCOUNT_NAME.$VTEX_ENVIRONMENT.com.br/api/catalog_system/pvt/products/GetProductAndSkuIds?_from=1&_to=50" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print('products:', len(d['data']), 'total:', d['range']['total'])"
```
Expected: at least 8 products after Task 1's seeding.

- [ ] **Step 8: Verify and commit**

Run: `pnpm run dev:prepare && pnpm run lint && pnpm test`

```bash
git add src/runtime/server/vtex-helper/pageIndexEntries.ts src/runtime/server/vtex-helper/pageIndexEntries.test.ts src/runtime/server/orchestr/product/ src/runtime/server/orchestr/category/
git commit -m "feat: add product, listing and search page-indexes"
```

---

## Task 15: Query templates and the error-mapping pass

**Files:**
- Create: `src/runtime/server/orchestr/product/byCategorySlug.template.ts`
- Create: `src/runtime/server/orchestr/menu/byAlias.template.ts`
- Modify: every handler that calls VTEX, to map `VtexApiError` onto canonical errors

**Interfaces:**
- Consumes: `defineVtexQueryTemplateProvider` (Task 6), tree helpers (Task 8), `VtexApiError` (Task 4).
- Produces: nothing other tasks import.

Templates give Studio editors named presets instead of a free-text id field.

- [ ] **Step 1: Write the category-slug template**

```ts
// src/runtime/server/orchestr/product/byCategorySlug.template.ts
import { ProductsByCategorySlugQuery } from '@laioutr-core/canonical-types/ecommerce';
import { defineVtexQueryTemplateProvider } from '../../middleware/defineVtex';
import { flatten, loadCategoryTree, slugFromUrl } from '../../vtex-helper/categoryTree';

export default defineVtexQueryTemplateProvider({
  for: ProductsByCategorySlugQuery,
  provide: async ({ context }) => ({
    templates: flatten(await loadCategoryTree(context.vtexClient)).map((n) => ({
      inputRules: { slug: { literal: slugFromUrl(n.url) } },
      label: n.name,
    })),
  }),
});
```

- [ ] **Step 2: Write the menu template**

```ts
// src/runtime/server/orchestr/menu/byAlias.template.ts
import { MenuByAliasQuery } from '@laioutr-core/canonical-types/ecommerce';
import { defineVtexQueryTemplateProvider } from '../../middleware/defineVtex';
import { loadCategoryTree, slugFromUrl } from '../../vtex-helper/categoryTree';

export default defineVtexQueryTemplateProvider({
  for: MenuByAliasQuery,
  provide: async ({ context }) => ({
    templates: [
      { inputRules: { alias: { literal: 'main' } }, label: 'Main navigation' },
      // Only root categories: a menu rooted at a leaf has nothing to render.
      ...(await loadCategoryTree(context.vtexClient)).map((n) => ({
        inputRules: { alias: { literal: slugFromUrl(n.url) } },
        label: n.name,
      })),
    ],
  }),
});
```

- [ ] **Step 3: Add the error mapping**

Every handler that calls VTEX wraps its call so a transport failure becomes a canonical error the storefront can act on. Apply this shape in `bySlug.query.ts`, `byCategorySlug.query.ts`, `byCategoryId.query.ts` and the resolvers:

```ts
import { VtexApiError } from '../../client/types';
import { ProductNotFoundError } from '@laioutr-core/canonical-types/ecommerce';

try {
  // …the existing call…
} catch (error) {
  // A 404 here means the entity does not exist; anything else is a transport fault worth surfacing.
  if (error instanceof VtexApiError && error.status === 404) {
    throw new ProductNotFoundError(`No product for slug: ${input.slug}`);
  }
  throw error;
}
```

Use `CategoryNotFoundError` in the category handlers and `ProductNotFoundError` in the product ones. Do **not** swallow non-404 failures — a 500 from VTEX must not read as "no such product".

- [ ] **Step 4: Full verification**

Run:
```bash
pnpm install --frozen-lockfile
pnpm run dev:prepare
pnpm run lint
pnpm test
```
Expected: all four clean. `pnpm exec vue-tsc --noEmit` should report only the three pre-existing template errors.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/server/orchestr/
git commit -m "feat: add query templates and canonical error mapping"
```

---

## Done

At this point the read path is complete: category, menu, product, product-variant, search and the three page-indexes, all bound to canonical tokens and verified against the seeded account.

**Deliberately not built, and why:**
- Suggested search / autocomplete — Intelligent Search is not active on the account and Legacy Search has no equivalent.
- `ProductRating` — needs the reviews API, which is a later round.
- Cart, auth, customer, address, order, wishlist, reviews — mutations, each its own round.
