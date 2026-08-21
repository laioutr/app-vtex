# VTEX Cart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bind the canonical `Cart` and `CartItem` entities to VTEX's Checkout orderForm — the read path, the three mutations and the checkout URL — as the app's first mutation path.

**Architecture:** One `vtex-helper/orderForm.ts` owns the orderForm lifecycle; no handler calls `/checkout/pub` directly. `CartItem.id` is VTEX's stable `uniqueId`, resolved to a positional index at mutation time from the snapshot `messages/clear` returns, because `items/update` accepts an index only and indices shift on removal. Cookies are re-emitted through frontend-core's `setManagedCookie` rather than passed through raw, because VTEX stamps its own domain on every `Set-Cookie` and the browser rejects it on the storefront's origin.

**Tech Stack:** Nuxt 3 module (`@nuxt/kit`), Nitro, `@laioutr-core/orchestr` + `kit` + `canonical-types` + `core-types` + `frontend-core`, Vitest, `@screeny05/ts-money`, `cookie-es`, zod.

**Spec:** [`docs/plans/2026-08-21-vtex-cart-design.md`](./2026-08-21-vtex-cart-design.md) — read it alongside this plan. Account state and API traps are in [`docs/environment.md`](../environment.md).

## Global Constraints

- **Money is `{ amount, currency }` with `amount` in minor units and `currency` an ISO 4217 code.** Checkout returns minor units already, so `fromMinorUnits` — never `fromDecimal` — on this path.
- **Never price a line from `sellingPrice`.** VTEX documents it as not rounding-safe. Use `priceDefinition.calculatedSellingPrice` and `priceDefinition.total`.
- **Cart currency comes from `storePreferencesData.currencyCode`**, not `clientEnv.market.currency`. The product resolvers do the opposite, deliberately.
- **Fail-soft governs this app** — see `.claude/rules/fail-soft-resilience.md`. Guard inside the loop, and every fallback emits a `console.warn` naming the unit (`uniqueId`, `orderFormId`, currency code) and what was substituted. A bare `catch {}` fails review.
- **Mutations fail hard, attributed.** Reads degrade per line; actions throw on whole-call failure.
- **`extendRequest` context keys are namespaced** (`vtexClient`, `vtexAccountName`, `vtexSalesChannel`, `vtexIsAuthenticated`) — the object merges into a context shared by every installed app.
- **`JSON.stringify(clientEnv)` throws.** `market`/`language`/`domain` are cyclic. Pick fields explicitly.
- **Actions have no `passthrough` and no `$entity`.** `OrchestrArgsAction` carries `context`, `input`, `event`, `clientEnv` and `meta` only.
- **Comments explain why, not what.** No design-doc references in code, comments, test names or error messages — no `§4`, no doc paths, no plan IDs.
- **No Vue component tests.** Tests cover helpers, mappers and pure logic.
- **Conventional commits, Angular style:** `feat(scope): …`, `fix: …`, `chore: …`. **Commit to the branch that is already checked out — never create or switch branches.**
- **Run `pnpm dev:prepare` before `pnpm lint` or `pnpm test:types`.** Without it every import reports as unresolved.

---

### Task 1: Write VTEX's cookies back so the browser keeps them

This is a live bug on `main`, not new work: `vtexClientFactory` appends VTEX's `Set-Cookie` verbatim, VTEX stamps `domain={account}.vtexcommercestable.com.br` on it, and the browser drops it on the storefront's origin — `localhost` included. The read path never noticed because it needs no cookie to survive. Nothing in the cart works until this lands.

**Files:**
- Modify: `src/runtime/server/client/cookies.ts`
- Modify: `src/runtime/server/middleware/defineVtex.ts:36-37`
- Modify: `package.json` (add `cookie-es` to `dependencies`)
- Test: `src/runtime/server/client/cookies.test.ts`

**Interfaces:**
- Consumes: `VTEX_SESSION`, `VTEX_SEGMENT`, `CHECKOUT_ORDER_FORM`, `authCookieName` — already exported from `cookies.ts`.
- Produces: `parseVtexSetCookie(raw: string, accountName: string): VtexCookieWrite | undefined` and `interface VtexCookieWrite { name: string; value: string; expires?: Date }`.

- [ ] **Step 1: Add the dependency**

```bash
pnpm add cookie-es
```

`cookie-es` is already in the tree under h3, but relying on a transitive dependency is not a declaration. It is needed for `parseSetCookie`, which handles the case a hand-rolled `split('=')` gets wrong: the orderForm value is `__ofid=<id>`, so the value itself contains `=`.

- [ ] **Step 2: Write the failing tests**

Append to `src/runtime/server/client/cookies.test.ts`:

```ts
import { parseVtexSetCookie } from './cookies';

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
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm vitest run src/runtime/server/client/cookies.test.ts`
Expected: FAIL — `parseVtexSetCookie is not a function`.

- [ ] **Step 4: Implement**

Append to `src/runtime/server/client/cookies.ts`:

```ts
import { parseSetCookie } from 'cookie-es';

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
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run src/runtime/server/client/cookies.test.ts`
Expected: PASS, including the pre-existing suites.

- [ ] **Step 6: Wire it into the middleware**

In `src/runtime/server/middleware/defineVtex.ts`, replace the `onSetCookie` line:

```ts
      onSetCookie: (raw) => {
        const cookie = parseVtexSetCookie(raw, config.accountName);
        if (!cookie) return;

        // `sameSite: 'lax'` rather than 'strict': the shopper returns from VTEX's checkout domain
        // on a top-level GET, which 'strict' would strip the cart cookie from.
        setManagedCookie(args.event, cookie.name, cookie.value, {
          httpOnly: true,
          path: '/',
          sameSite: 'lax',
          expires: cookie.expires,
        });
      },
```

Update the imports at the top of the file — `appendResponseHeader` is now unused:

```ts
import { parseCookies } from 'h3';
import { defineOrchestr, setManagedCookie, useRuntimeConfig } from '#imports';
import { parseVtexSetCookie } from '../client/cookies';
```

- [ ] **Step 7: Verify the module still builds and type-checks**

Run: `pnpm dev:prepare && pnpm lint && pnpm test`
Expected: no errors from these files. `pnpm test:types` still reports the two inherited `globalExtensions.ts` TS2717 errors documented in `docs/environment.md` — those are pre-existing and not yours.

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-lock.yaml src/runtime/server/client/cookies.ts src/runtime/server/client/cookies.test.ts src/runtime/server/middleware/defineVtex.ts
git commit -m "fix: write VTEX cookies back on the storefront's own origin"
```

---

### Task 2: OrderForm types and a money guard that cannot blank the cart

**Files:**
- Create: `src/runtime/server/types/vtexCheckout.ts`
- Modify: `src/runtime/server/vtex-helper/money.ts`
- Test: `src/runtime/server/vtex-helper/money.test.ts`

**Interfaces:**
- Produces: `VtexOrderForm`, `VtexOrderFormItem`, `VtexOrderFormMessage`, `VtexOrderFormTotalizer` from `types/vtexCheckout.ts`; `tryFromMinorUnits(amount: number, currency: string): Money | undefined` from `vtex-helper/money.ts`.

- [ ] **Step 1: Write the orderForm types**

Create `src/runtime/server/types/vtexCheckout.ts`. Hand-written rather than generated: VTEX's Checkout OpenAPI declares only 8 component schemas across 37 paths, so generating it yields inline shapes rather than named types.

```ts
/** A per-row outcome VTEX reports alongside an HTTP 200, not an error status. */
export interface VtexOrderFormMessage {
  code: string;
  text: string;
  status: 'error' | 'warning' | 'info' | (string & {});
  fields?: { id?: string; [field: string]: unknown } | null;
}

/** The rounding-safe prices. `sellingPrice` sits beside these and is not. */
export interface VtexOrderFormPriceDefinition {
  calculatedSellingPrice: number;
  total: number;
}

export interface VtexOrderFormItem {
  uniqueId: string;
  /** The SKU id — a canonical `ProductVariant` id. */
  id: string;
  productId: string;
  name: string;
  skuName?: string | null;
  refId?: string | null;
  ean?: string | null;
  quantity: number;
  seller?: string | null;
  price: number;
  listPrice?: number | null;
  sellingPrice?: number | null;
  priceDefinition?: VtexOrderFormPriceDefinition | null;
  imageUrl?: string | null;
  detailUrl?: string | null;
  availability?: string | null;
  measurementUnit?: string | null;
  /** Step size the SKU is sold in; a six-pack carries 6. */
  unitMultiplier?: number | null;
  additionalInfo?: { brandName?: string | null } | null;
}

export interface VtexOrderFormTotalizer {
  id: string;
  name: string;
  value: number;
}

export interface VtexOrderForm {
  orderFormId: string;
  salesChannel: string;
  /** The whole cart in minor units. */
  value: number;
  items: VtexOrderFormItem[];
  messages: VtexOrderFormMessage[];
  totalizers: VtexOrderFormTotalizer[];
  storePreferencesData?: { currencyCode?: string | null } | null;
  shippingData?: { selectedAddresses?: unknown[] | null } | null;
}

/** The body `POST /orderForm/{id}/items` takes. `seller` is required; omitting it answers 400. */
export interface VtexOrderItemAdd {
  id: string;
  quantity: number;
  seller: string;
}

/** The body `POST /orderForm/{id}/items/update` takes. It accepts an index and nothing else. */
export interface VtexOrderItemUpdate {
  index: number;
  quantity: number;
}
```

- [ ] **Step 2: Write the failing money tests**

Append to `src/runtime/server/vtex-helper/money.test.ts`:

```ts
import { tryFromMinorUnits } from './money';

describe('tryFromMinorUnits', () => {
  it('behaves like fromMinorUnits for a currency ts-money knows', () => {
    expect(tryFromMinorUnits(4999, 'EUR')?.getAmount()).toBe(4999);
  });

  it('returns undefined instead of throwing on a currency VTEX made up', () => {
    expect(tryFromMinorUnits(4999, 'XYZ')).toBeUndefined();
  });

  it('returns undefined for an absent amount rather than minting NaN cents', () => {
    expect(tryFromMinorUnits(Number.NaN, 'EUR')).toBeUndefined();
    expect(tryFromMinorUnits(Number.POSITIVE_INFINITY, 'EUR')).toBeUndefined();
  });

  it('warns when it degrades, naming what it dropped', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    tryFromMinorUnits(4999, 'XYZ');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('XYZ'));
    warn.mockRestore();
  });
});
```

Add `vi` to the existing `vitest` import at the top of the file.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm vitest run src/runtime/server/vtex-helper/money.test.ts`
Expected: FAIL — `tryFromMinorUnits is not a function`.

- [ ] **Step 4: Implement**

Append to `src/runtime/server/vtex-helper/money.ts`:

```ts
/**
 * The cart's currency comes from VTEX rather than from configuration, and ts-money throws on a code
 * it does not know. Unguarded, one unexpected code would take the whole cart down instead of the
 * money on it, so the caller drops the affected component and keeps the rest.
 */
export const tryFromMinorUnits = (amount: number, currency: string): Money | undefined => {
  if (!Number.isFinite(amount)) {
    console.warn(`[app-vtex] no usable amount for a ${currency} value; dropping it`);
    return undefined;
  }

  try {
    return fromMinorUnits(amount, currency);
  } catch {
    console.warn(`[app-vtex] VTEX reported the unknown currency ${currency}; dropping its money`);
    return undefined;
  }
};
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run src/runtime/server/vtex-helper/money.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/runtime/server/types/vtexCheckout.ts src/runtime/server/vtex-helper/money.ts src/runtime/server/vtex-helper/money.test.ts
git commit -m "feat: add VTEX checkout orderForm types and a guarded money constructor"
```

---

### Task 3: The orderForm lifecycle helper

**Files:**
- Create: `src/runtime/server/vtex-helper/orderForm.ts`
- Test: `src/runtime/server/vtex-helper/orderForm.test.ts`

**Interfaces:**
- Consumes: `VtexClient` and `VtexApiError` from `client/types`; the types from Task 2; `CHECKOUT_ORDER_FORM` from `client/cookies`.
- Produces:
  - `parseOrderFormId(cookieValue: string | undefined): string | undefined`
  - `createOrderForm(client: VtexClient): Promise<VtexOrderForm>`
  - `readOrderForm(client: VtexClient, id: string): Promise<VtexOrderForm | undefined>`
  - `clearMessagesAndRead(client: VtexClient, id: string): Promise<VtexOrderForm>`
  - `indexByUniqueId(orderForm: VtexOrderForm): Map<string, number>`
  - `toOrderItemUpdates(rows: { itemId: string; quantity?: number }[], index: Map<string, number>): VtexOrderItemUpdate[]`
  - `toBatchResults(requested: RequestedRow[], before: VtexOrderForm, after: VtexOrderForm): CartBatchResultItem[]`
  - `interface RequestedRow { productId: string; variantId: string }`
  - `type CartBatchResultItem` — derived from `CartAddItemsAction`'s output, because
    `canonical-types` exposes no import path for it

- [ ] **Step 1: Write the failing tests**

Create `src/runtime/server/vtex-helper/orderForm.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import type { VtexOrderForm, VtexOrderFormItem } from '../types/vtexCheckout';
import {
  indexByUniqueId,
  parseOrderFormId,
  toBatchResults,
  toOrderItemUpdates,
} from './orderForm';

const item = (over: Partial<VtexOrderFormItem>): VtexOrderFormItem => ({
  uniqueId: 'U1',
  id: '146835',
  productId: '146835',
  name: 'FILA Slip On Sneaker',
  quantity: 1,
  price: 4999,
  availability: 'available',
  ...over,
});

const orderForm = (items: VtexOrderFormItem[], messages: VtexOrderForm['messages'] = []): VtexOrderForm => ({
  orderFormId: 'OF1',
  salesChannel: '1',
  value: items.reduce((sum, i) => sum + i.price * i.quantity, 0),
  items,
  messages,
  totalizers: [],
});

describe('parseOrderFormId', () => {
  it('strips the __ofid prefix VTEX wraps the id in', () => {
    expect(parseOrderFormId('__ofid=70542a28bdf143eda4178002d09d6b67')).toBe(
      '70542a28bdf143eda4178002d09d6b67'
    );
  });

  it('is undefined for an absent, empty or unprefixed cookie', () => {
    expect(parseOrderFormId(undefined)).toBeUndefined();
    expect(parseOrderFormId('')).toBeUndefined();
    expect(parseOrderFormId('__ofid=')).toBeUndefined();
    expect(parseOrderFormId('70542a28')).toBeUndefined();
  });
});

describe('indexByUniqueId', () => {
  it('maps each line to its position, which is the only thing VTEX accepts', () => {
    const map = indexByUniqueId(orderForm([item({ uniqueId: 'A' }), item({ uniqueId: 'B' })]));
    expect(map.get('A')).toBe(0);
    expect(map.get('B')).toBe(1);
  });
});

describe('toOrderItemUpdates', () => {
  const index = new Map([
    ['A', 0],
    ['B', 1],
  ]);

  it('translates a uniqueId to its index', () => {
    expect(toOrderItemUpdates([{ itemId: 'B', quantity: 3 }], index)).toEqual([
      { index: 1, quantity: 3 },
    ]);
  });

  it('skips a line that is already gone rather than moving another line s index', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(toOrderItemUpdates([{ itemId: 'GONE', quantity: 3 }], index)).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('GONE'));
    warn.mockRestore();
  });

  it('skips a row carrying no quantity, which the token documents as ignorable', () => {
    expect(toOrderItemUpdates([{ itemId: 'A' }], index)).toEqual([]);
  });
});

describe('toBatchResults', () => {
  const requested = [{ productId: '146835', variantId: '146835' }];

  it('reports a row VTEX accepted as added, with the quantity actually gained', () => {
    const before = orderForm([]);
    const after = orderForm([item({ quantity: 2 })]);
    expect(toBatchResults(requested, before, after)).toEqual([
      { status: 'added', productId: '146835', variantId: '146835', quantity: 2 },
    ]);
  });

  it('reports a clamped quantity as added, not as an error', () => {
    const before = orderForm([]);
    const after = orderForm([item({ quantity: 50 })], [
      { code: 'itemMaxQuantityLimitReached', text: 'You can t have more than 50', status: 'info' },
    ]);
    expect(toBatchResults(requested, before, after)[0]).toMatchObject({
      status: 'added',
      quantity: 50,
    });
  });

  it('reports an unknown SKU as a rejected row, because VTEX answers 200 for it', () => {
    const before = orderForm([]);
    const after = orderForm([], [
      { code: 'ORD027', text: 'Item 999999999 not found', status: 'error', fields: { id: '999999999' } },
    ]);
    expect(toBatchResults([{ productId: 'p', variantId: '999999999' }], before, after)).toEqual([
      { status: 'rejected', productId: 'p', variantId: '999999999', reason: 'not-found' },
    ]);
  });

  it('reports a line VTEX added but cannot fulfil as sold-out', () => {
    const before = orderForm([]);
    const after = orderForm([item({ availability: 'withoutStock' })]);
    expect(toBatchResults(requested, before, after)[0]).toMatchObject({
      status: 'rejected',
      reason: 'sold-out',
    });
  });

  it('counts only the gain, so adding to an existing line does not re-report it', () => {
    const before = orderForm([item({ quantity: 1 })]);
    const after = orderForm([item({ quantity: 3 })]);
    expect(toBatchResults(requested, before, after)[0]).toMatchObject({ quantity: 2 });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/runtime/server/vtex-helper/orderForm.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement**

Create `src/runtime/server/vtex-helper/orderForm.ts`:

```ts
import type { CartAddItemsAction } from '@laioutr-core/canonical-types/ecommerce';
import type { ActionTokenOutputOf } from '@laioutr-core/core-types/orchestr';
import type { VtexClient } from '../client/types';
import type {
  VtexOrderForm,
  VtexOrderItemUpdate,
} from '../types/vtexCheckout';
import { VtexApiError } from '../client/types';

const OFID_PREFIX = '__ofid=';

/**
 * `canonical-types` ships no import path for this shape, so it is read back off the token that
 * defines it — which also means it cannot drift from what the action must return.
 */
export type CartBatchResultItem = ActionTokenOutputOf<typeof CartAddItemsAction>['items'][number];

export interface RequestedRow {
  productId: string;
  variantId: string;
}

/** VTEX wraps the id in its own key inside the cookie value rather than storing it bare. */
export const parseOrderFormId = (cookieValue: string | undefined): string | undefined => {
  if (!cookieValue?.startsWith(OFID_PREFIX)) return undefined;
  return cookieValue.slice(OFID_PREFIX.length).trim() || undefined;
};

/**
 * Mints a cart. VTEX has no read-only mode, so only an action may call this. The cart cookie needs
 * no explicit write: VTEX answers this call with a `Set-Cookie`, which the client already routes to
 * the managed-cookie writer.
 */
export const createOrderForm = (client: VtexClient): Promise<VtexOrderForm> =>
  client.publicFetch<VtexOrderForm>('checkout', '/api/checkout/pub/orderForm', {
    method: 'POST',
    body: '{}',
  });

/**
 * A 404 means the cart expired upstream, which is knowledge rather than failure — the caller clears
 * the cookie. Every other status rethrows: an empty cart shown to a shopper who has three items
 * invites them to add everything twice.
 */
export const readOrderForm = async (
  client: VtexClient,
  id: string
): Promise<VtexOrderForm | undefined> => {
  try {
    return await client.publicFetch<VtexOrderForm>(
      'checkout',
      `/api/checkout/pub/orderForm/${encodeURIComponent(id)}`
    );
  } catch (error) {
    if (error instanceof VtexApiError && error.status === 404) {
      console.warn(`[app-vtex] orderForm ${id} is gone upstream; treating the shopper as cartless`);
      return undefined;
    }
    throw error;
  }
};

/**
 * Messages persist on an orderForm until something clears them, so a mutation that read them
 * without clearing first would keep re-reporting a rejection from ten minutes ago. The response
 * carries the whole orderForm, which is also the snapshot an index map and a quantity diff need.
 */
export const clearMessagesAndRead = (client: VtexClient, id: string): Promise<VtexOrderForm> =>
  client.publicFetch<VtexOrderForm>(
    'checkout',
    `/api/checkout/pub/orderForm/${encodeURIComponent(id)}/messages/clear`,
    { method: 'POST', body: '{}' }
  );

export const indexByUniqueId = (orderForm: VtexOrderForm): Map<string, number> =>
  new Map(orderForm.items.map((line, index) => [line.uniqueId, index]));

/**
 * `items/update` addresses lines by position and nothing else, and positions shift when a line is
 * removed. A `uniqueId` the snapshot does not know is a line that is already gone, so it is dropped
 * rather than translated into whatever now sits at that position.
 */
export const toOrderItemUpdates = (
  rows: { itemId: string; quantity?: number }[],
  index: Map<string, number>
): VtexOrderItemUpdate[] =>
  rows.flatMap((row) => {
    if (row.quantity === undefined) return [];

    const position = index.get(row.itemId);
    if (position === undefined) {
      console.warn(`[app-vtex] cart line ${row.itemId} is no longer in the cart; skipping it`);
      return [];
    }

    return [{ index: position, quantity: row.quantity }];
  });

const quantityOfSku = (orderForm: VtexOrderForm, skuId: string): number =>
  orderForm.items.filter((line) => line.id === skuId).reduce((sum, line) => sum + line.quantity, 0);

/**
 * VTEX answers 200 for a row it refused and names the reason in `messages`, so a per-row failure is
 * an outcome to report rather than an error to throw — which is exactly how the token defines it.
 */
export const toBatchResults = (
  requested: RequestedRow[],
  before: VtexOrderForm,
  after: VtexOrderForm
): CartBatchResultItem[] =>
  requested.map((row) => {
    const rejectedUpstream = after.messages.some(
      (message) => message.code === 'ORD027' && message.fields?.id === row.variantId
    );
    const line = after.items.find((candidate) => candidate.id === row.variantId);

    if (rejectedUpstream || !line) {
      return {
        status: 'rejected',
        productId: row.productId,
        variantId: row.variantId,
        reason: 'not-found',
      };
    }

    if (line.availability && line.availability !== 'available') {
      return {
        status: 'rejected',
        productId: row.productId,
        variantId: row.variantId,
        reason: 'sold-out',
        reasonLabel: line.availability,
      };
    }

    // The gain, not the line total: adding to a line that already held two must not report four.
    const gained = quantityOfSku(after, row.variantId) - quantityOfSku(before, row.variantId);

    return {
      status: 'added',
      productId: row.productId,
      variantId: row.variantId,
      quantity: Math.max(gained, 0),
    };
  });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/runtime/server/vtex-helper/orderForm.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/server/vtex-helper/orderForm.ts src/runtime/server/vtex-helper/orderForm.test.ts
git commit -m "feat: add the VTEX orderForm lifecycle helper"
```

---

### Task 4: The cart mappers

**Files:**
- Create: `src/runtime/server/vtex-helper/mappers/cart.ts`
- Test: `src/runtime/server/vtex-helper/mappers/cart.test.ts`

**Interfaces:**
- Consumes: `tryFromMinorUnits` (Task 2); `VtexOrderForm`, `VtexOrderFormItem` (Task 2).
- Produces: `currencyOf`, `normalizeImageUrl`, `slugFromDetailUrl`, `toCartBase`, `toCartCost`, `toCartItemBase`, `toCartItemCost`, `toCartItemAvailability`, `toCartItemQuantityRule`.

- [ ] **Step 1: Write the failing tests**

Create `src/runtime/server/vtex-helper/mappers/cart.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import type { VtexOrderForm, VtexOrderFormItem } from '../../types/vtexCheckout';
import {
  currencyOf,
  normalizeImageUrl,
  slugFromDetailUrl,
  toCartBase,
  toCartCost,
  toCartItemAvailability,
  toCartItemBase,
  toCartItemCost,
  toCartItemQuantityRule,
} from './cart';

const item = (over: Partial<VtexOrderFormItem> = {}): VtexOrderFormItem => ({
  uniqueId: 'U1',
  id: '756290',
  productId: '137327',
  name: 'Laioutr Test Sneaker',
  skuName: 'Laioutr Test Sneaker Rot 42',
  refId: 'LTS-42-ROT',
  quantity: 2,
  price: 5999,
  listPrice: 7999,
  priceDefinition: { calculatedSellingPrice: 5999, total: 11998 },
  imageUrl: 'https://x.vteximg.com.br/arquivos/ids/157422-55-55/756290-Rot.jpg?v=1',
  detailUrl: '/laioutr-test-sneaker/p',
  availability: 'available',
  unitMultiplier: 1,
  additionalInfo: { brandName: 'FILA' },
  ...over,
});

const orderForm = (over: Partial<VtexOrderForm> = {}): VtexOrderForm => ({
  orderFormId: 'OF1',
  salesChannel: '1',
  value: 11998,
  items: [item()],
  messages: [],
  totalizers: [{ id: 'Items', name: 'Items Total', value: 11998 }],
  storePreferencesData: { currencyCode: 'EUR' },
  ...over,
});

describe('currencyOf', () => {
  it('reads the currency VTEX priced the cart in', () => {
    expect(currencyOf(orderForm())).toBe('EUR');
  });

  it('is undefined when VTEX reports none', () => {
    expect(currencyOf(orderForm({ storePreferencesData: null }))).toBeUndefined();
  });
});

describe('normalizeImageUrl', () => {
  it('drops the thumbnail size VTEX bakes into the id segment', () => {
    expect(normalizeImageUrl(item().imageUrl!)).toBe(
      'https://x.vteximg.com.br/arquivos/ids/157422/756290-Rot.jpg?v=1'
    );
  });

  it('leaves a url carrying no size alone', () => {
    expect(normalizeImageUrl('https://x/arquivos/ids/157422/a.jpg')).toBe(
      'https://x/arquivos/ids/157422/a.jpg'
    );
  });
});

describe('slugFromDetailUrl', () => {
  it('takes the slug out of VTEX s detail path', () => {
    expect(slugFromDetailUrl('/laioutr-test-sneaker/p')).toBe('laioutr-test-sneaker');
  });

  it('is undefined for a path it does not recognise', () => {
    expect(slugFromDetailUrl(undefined)).toBeUndefined();
    expect(slugFromDetailUrl('/some/other/path')).toBeUndefined();
  });
});

describe('toCartBase', () => {
  it('sums the line quantities', () => {
    expect(toCartBase(orderForm({ items: [item({ quantity: 2 }), item({ quantity: 3 })] }), 'https://c').totalQuantity).toBe(5);
  });

  it('carries the checkout url as a link', () => {
    expect(toCartBase(orderForm(), 'https://c/checkout').checkoutLink).toEqual({
      type: 'url',
      href: 'https://c/checkout',
    });
  });
});

describe('toCartCost', () => {
  it('takes the subtotal from the Items totalizer and the total from the cart value', () => {
    const cost = toCartCost(orderForm(), 'EUR')!;
    expect(cost.subtotal.getAmount()).toBe(11998);
    expect(cost.total.getAmount()).toBe(11998);
  });

  it('estimates the total until a shipping address exists', () => {
    expect(toCartCost(orderForm(), 'EUR')!.totalIsEstimated).toBe(true);
    expect(
      toCartCost(orderForm({ shippingData: { selectedAddresses: [{}] } }), 'EUR')!.totalIsEstimated
    ).toBe(false);
  });

  it('omits shipping and tax when their totalizers are absent, which is the normal cart', () => {
    const cost = toCartCost(orderForm(), 'EUR')!;
    expect(cost.shipping).toBeUndefined();
    expect(cost.tax).toBeUndefined();
  });

  it('falls back to the summed line totals when the Items totalizer is missing', () => {
    expect(toCartCost(orderForm({ totalizers: [] }), 'EUR')!.subtotal.getAmount()).toBe(11998);
  });

  it('degrades to undefined on a currency ts-money cannot take, rather than throwing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(toCartCost(orderForm(), 'XYZ')).toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('toCartItemBase', () => {
  it('maps the identity fields a cart row shows', () => {
    const base = toCartItemBase(item());
    expect(base).toMatchObject({
      type: 'product',
      quantity: 2,
      title: 'Laioutr Test Sneaker',
      subtitle: 'Laioutr Test Sneaker Rot 42',
      brand: 'FILA',
      code: 'LTS-42-ROT',
    });
  });

  it('links to the product detail page', () => {
    expect(toCartItemBase(item()).link).toEqual({
      type: 'reference',
      reference: { type: 'Product', id: '137327', slug: 'laioutr-test-sneaker' },
    });
  });

  it('omits the link rather than failing the line when the detail url is unusable', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(toCartItemBase(item({ detailUrl: null })).link).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('U1'));
    warn.mockRestore();
  });

  it('omits a subtitle that only repeats the title', () => {
    expect(toCartItemBase(item({ skuName: 'Laioutr Test Sneaker' })).subtitle).toBeUndefined();
  });
});

describe('toCartItemCost', () => {
  it('prices from priceDefinition, never from sellingPrice', () => {
    const cost = toCartItemCost(item({ sellingPrice: 1 }), 'EUR')!;
    expect(cost.single.getAmount()).toBe(5999);
    expect(cost.total.getAmount()).toBe(11998);
  });

  it('strikes through the list price when it beats what the shopper pays', () => {
    expect(toCartItemCost(item(), 'EUR')!.singleStrikethrough?.getAmount()).toBe(7999);
  });

  it('has no strikethrough on a flat-priced line', () => {
    expect(toCartItemCost(item({ listPrice: 5999 }), 'EUR')!.singleStrikethrough).toBeUndefined();
  });

  it('drops a line VTEX priced with no priceDefinition instead of guessing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(toCartItemCost(item({ priceDefinition: null }), 'EUR')).toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('toCartItemAvailability', () => {
  it('is in stock only for VTEX s available', () => {
    expect(toCartItemAvailability(item()).status).toBe('inStock');
    expect(toCartItemAvailability(item({ availability: 'withoutStock' })).status).toBe('outOfStock');
  });
});

describe('toCartItemQuantityRule', () => {
  it('steps by the unit multiplier, and its minimum matches the step', () => {
    expect(toCartItemQuantityRule(item({ unitMultiplier: 6 }))).toEqual({
      min: 6,
      increment: 6,
      canChange: true,
    });
  });

  it('falls back to single units when VTEX reports no multiplier', () => {
    expect(toCartItemQuantityRule(item({ unitMultiplier: null }))).toEqual({
      min: 1,
      increment: 1,
      canChange: true,
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/runtime/server/vtex-helper/mappers/cart.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement**

Create `src/runtime/server/vtex-helper/mappers/cart.ts`:

```ts
import type { Link, MediaImage } from '@laioutr-core/core-types/common';
import type { Money } from '@screeny05/ts-money';
import type { VtexOrderForm, VtexOrderFormItem } from '../../types/vtexCheckout';
import { tryFromMinorUnits } from '../money';

/**
 * The cart reports the currency VTEX actually charged in, which is not necessarily the market's:
 * a sales channel may price elsewhere, and the shopper pays what checkout says.
 */
export const currencyOf = (orderForm: VtexOrderForm): string | undefined =>
  orderForm.storePreferencesData?.currencyCode ?? undefined;

const SIZED_ID_SEGMENT = /(\/arquivos\/ids\/\d+)-\d+-\d+/;

/** An orderForm image is a 55px thumbnail; the image provider needs the unsized original. */
export const normalizeImageUrl = (url: string): string => url.replace(SIZED_ID_SEGMENT, '$1');

const DETAIL_PATH = /^\/?([^/?#]+)\/p(?:[?#].*)?$/;

export const slugFromDetailUrl = (detailUrl: string | null | undefined): string | undefined =>
  detailUrl ? DETAIL_PATH.exec(detailUrl)?.[1] : undefined;

const totalizerValue = (orderForm: VtexOrderForm, id: string): number | undefined =>
  orderForm.totalizers?.find((totalizer) => totalizer.id === id)?.value;

export const toCartBase = (orderForm: VtexOrderForm, checkoutUrl: string) => ({
  totalQuantity: orderForm.items.reduce((sum, line) => sum + line.quantity, 0),
  checkoutLink: { type: 'url' as const, href: checkoutUrl },
});

export const toCartCost = (orderForm: VtexOrderForm, currency: string) => {
  // Derived from the same numbers VTEX totalled, so the fallback is arithmetic rather than a guess.
  const itemsTotal =
    totalizerValue(orderForm, 'Items') ??
    orderForm.items.reduce((sum, line) => sum + (line.priceDefinition?.total ?? Number.NaN), 0);

  const subtotal = tryFromMinorUnits(itemsTotal, currency);
  const total = tryFromMinorUnits(orderForm.value, currency);
  if (!subtotal || !total) return undefined;

  // Without a shipping address VTEX has nothing to charge carriage on, so the total is provisional.
  const isEstimated = (orderForm.shippingData?.selectedAddresses?.length ?? 0) === 0;

  const shippingValue = totalizerValue(orderForm, 'Shipping');
  const taxValue = totalizerValue(orderForm, 'Tax');
  const shipping = shippingValue === undefined ? undefined : tryFromMinorUnits(shippingValue, currency);
  const tax = taxValue === undefined ? undefined : tryFromMinorUnits(taxValue, currency);

  return {
    subtotal,
    subtotalIsEstimated: false,
    total,
    totalIsEstimated: isEstimated,
    shipping: shipping ? { total: shipping, isEstimated } : undefined,
    tax: tax ? { total: tax, isEstimated, isIncluded: false } : undefined,
  };
};

const toProductLink = (line: VtexOrderFormItem): Link | undefined => {
  const slug = slugFromDetailUrl(line.detailUrl);
  if (!slug) {
    console.warn(`[app-vtex] cart line ${line.uniqueId} has no usable detail url; omitting its link`);
    return undefined;
  }

  return { type: 'reference', reference: { type: 'Product', id: line.productId, slug } };
};

const toCover = (line: VtexOrderFormItem): MediaImage | undefined =>
  line.imageUrl ?
    {
      type: 'image',
      alt: line.name,
      sources: [{ provider: 'vtex', src: normalizeImageUrl(line.imageUrl) }],
    }
  : undefined;

export const toCartItemBase = (line: VtexOrderFormItem) => ({
  type: 'product' as const,
  quantity: line.quantity,
  title: line.name,
  subtitle: line.skuName && line.skuName !== line.name ? line.skuName : undefined,
  brand: line.additionalInfo?.brandName ?? undefined,
  code: line.refId ?? line.ean ?? undefined,
  link: toProductLink(line),
  cover: toCover(line),
});

export const toCartItemCost = (line: VtexOrderFormItem, currency: string) => {
  // `sellingPrice` sits right here and is deliberately unread: VTEX documents it as not
  // rounding-safe and points at `priceDefinition` instead.
  const single = tryFromMinorUnits(line.priceDefinition?.calculatedSellingPrice ?? Number.NaN, currency);
  const total = tryFromMinorUnits(line.priceDefinition?.total ?? Number.NaN, currency);
  const subtotal = tryFromMinorUnits(line.price * line.quantity, currency);
  if (!single || !total || !subtotal) {
    console.warn(`[app-vtex] cart line ${line.uniqueId} carries no usable price; dropping it`);
    return undefined;
  }

  const listPrice =
    line.listPrice == null ? undefined : tryFromMinorUnits(line.listPrice, currency);
  const strikethrough: Money | undefined =
    listPrice?.greaterThan(single) ? listPrice : undefined;

  return { single, singleStrikethrough: strikethrough, subtotal, total };
};

export const toCartItemAvailability = (line: VtexOrderFormItem) => ({
  // The orderForm reports a status but no free-stock figure, so the line's own quantity stands in.
  quantity: line.quantity,
  status: line.availability === 'available' ? ('inStock' as const) : ('outOfStock' as const),
});

export const toCartItemQuantityRule = (line: VtexOrderFormItem) => {
  const increment = line.unitMultiplier && line.unitMultiplier > 0 ? line.unitMultiplier : 1;

  // The minimum has to be a multiple of the step, so a six-pack cannot start at one.
  return { min: increment, increment, canChange: true };
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/runtime/server/vtex-helper/mappers/cart.test.ts`
Expected: PASS, 21 tests.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/server/vtex-helper/mappers/cart.ts src/runtime/server/vtex-helper/mappers/cart.test.ts
git commit -m "feat: map the VTEX orderForm onto canonical cart components"
```

---

### Task 5: The cart query and its items link

**Files:**
- Modify: `src/runtime/server/const/passthroughTokens.ts`
- Create: `src/runtime/server/orchestr/cart/get-current.query.ts`
- Create: `src/runtime/server/orchestr/cart/cart-items.link.ts`

**Interfaces:**
- Consumes: `parseOrderFormId`, `readOrderForm` (Task 3); `CHECKOUT_ORDER_FORM` from `client/cookies`.
- Produces: `orderFormToken` — a passthrough token carrying `VtexOrderForm`, read by Tasks 6 and 7.

- [ ] **Step 1: Add the passthrough token**

Append to `src/runtime/server/const/passthroughTokens.ts`:

```ts
import type { VtexOrderForm } from '../types/vtexCheckout';

/**
 * The cart read during this request. The query, both resolvers and both links need the same
 * orderForm, and VTEX charges a round trip for each one that fetches it again.
 */
export const orderFormToken = createPassthroughToken<VtexOrderForm>('@laioutr/app-vtex/orderForm');
```

- [ ] **Step 2: Write the query handler**

Create `src/runtime/server/orchestr/cart/get-current.query.ts`:

```ts
import { GetCurrentCartQuery } from '@laioutr-core/canonical-types/ecommerce';
import { deleteManagedCookie, getCookie } from '#imports';
import { CHECKOUT_ORDER_FORM } from '../../client/cookies';
import { orderFormToken } from '../../const/passthroughTokens';
import { defineVtexQuery } from '../../middleware/defineVtex';
import { parseOrderFormId, readOrderForm } from '../../vtex-helper/orderForm';

export default defineVtexQuery(GetCurrentCartQuery, async ({ context, event, passthrough }) => {
  const orderFormId = parseOrderFormId(getCookie(event, CHECKOUT_ORDER_FORM));

  // VTEX has no read-only orderForm call, so resolving one here would mint a cart and set a cookie
  // on every visitor who ever renders a cart badge, bots included.
  if (!orderFormId) return { id: undefined };

  const orderForm = await readOrderForm(context.vtexClient, orderFormId);
  if (!orderForm) {
    deleteManagedCookie(event, CHECKOUT_ORDER_FORM, { path: '/' });
    return { id: undefined };
  }

  passthrough.set(orderFormToken, orderForm);

  return { id: orderForm.orderFormId };
});
```

- [ ] **Step 3: Write the items link**

Create `src/runtime/server/orchestr/cart/cart-items.link.ts`:

```ts
import { CartItemsLink } from '@laioutr-core/canonical-types/ecommerce';
import { orderFormToken } from '../../const/passthroughTokens';
import { defineVtexLink } from '../../middleware/defineVtex';

export default defineVtexLink({
  implements: CartItemsLink,
  run: async ({ passthrough }) => {
    const orderForm = passthrough.get(orderFormToken);
    if (!orderForm) return { links: [] };

    return {
      links: [
        {
          sourceId: orderForm.orderFormId,
          targetIds: orderForm.items.map((line) => line.uniqueId),
          entityTotal: orderForm.items.length,
        },
      ],
    };
  },
  // No cache block, here or on either resolver: a cart belongs to one shopper and changes on every
  // mutation, so a shared entry would hand someone another person's cart.
});
```

- [ ] **Step 4: Verify it builds and type-checks**

Run: `pnpm dev:prepare && pnpm lint && pnpm test`
Expected: clean for these files.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/server/const/passthroughTokens.ts src/runtime/server/orchestr/cart/get-current.query.ts src/runtime/server/orchestr/cart/cart-items.link.ts
git commit -m "feat: resolve the current VTEX cart and link its items"
```

---

### Task 6: The Cart component resolver

**Files:**
- Create: `src/runtime/server/orchestr/cart/base.resolver.ts`

**Interfaces:**
- Consumes: `orderFormToken` (Task 5); `currencyOf`, `toCartBase`, `toCartCost` (Task 4); `checkoutUrlFor` (Task 10 — define it here in Task 10's file, and import it; if Task 10 has not run yet, this task defines the import and Task 10 creates the module).
- Produces: nothing other tasks import.

> **Ordering note:** this task imports `checkoutUrlFor` from `../../vtex-helper/checkoutUrl`. Create that module in **Step 1 below** — Task 10 imports it rather than defining it.

- [ ] **Step 1: Create the shared checkout-url builder**

Create `src/runtime/server/vtex-helper/checkoutUrl.ts`:

```ts
/**
 * Our orderForm cookie is first-party to the storefront, so VTEX's checkout on its own domain
 * cannot read it — the binding has to travel in the URL instead.
 */
export const checkoutUrlFor = (
  accountName: string,
  environment: string,
  orderFormId?: string
): string => {
  const base = `https://${accountName}.${environment}.com.br/checkout/`;
  return orderFormId ? `${base}?orderFormId=${encodeURIComponent(orderFormId)}#/cart` : `${base}#/cart`;
};
```

- [ ] **Step 2: Write the resolver**

Create `src/runtime/server/orchestr/cart/base.resolver.ts`:

```ts
import { CartBase, CartCost } from '@laioutr-core/canonical-types/entity/cart';
import { useRuntimeConfig } from '#imports';
import { name } from '../../../../../package.json';
import { orderFormToken } from '../../const/passthroughTokens';
import { defineVtexComponentResolver } from '../../middleware/defineVtex';
import { checkoutUrlFor } from '../../vtex-helper/checkoutUrl';
import { currencyOf, toCartBase, toCartCost } from '../../vtex-helper/mappers/cart';

export default defineVtexComponentResolver({
  label: 'VTEX Cart Connector',
  entityType: 'Cart',
  provides: [CartBase, CartCost],
  resolve: async ({ passthrough, $entity }) => {
    const orderForm = passthrough.get(orderFormToken);
    if (!orderForm) return { entities: [] };

    const config = useRuntimeConfig()[name] as { accountName: string; environment: string };
    const checkoutUrl = checkoutUrlFor(config.accountName, config.environment, orderForm.orderFormId);
    const currency = currencyOf(orderForm);
    const cost = currency ? toCartCost(orderForm, currency) : undefined;

    if (!cost) {
      console.warn(
        `[app-vtex] cart ${orderForm.orderFormId} has no expressible money; serving it without costs`
      );
    }

    return {
      entities: [
        $entity({
          id: orderForm.orderFormId,
          base: () => toCartBase(orderForm, checkoutUrl),
          // Dropping only the cost keeps the shopper's items on screen when the money is unreadable.
          cost: () => cost,
        }),
      ],
    };
  },
});
```

- [ ] **Step 3: Verify**

Run: `pnpm dev:prepare && pnpm lint && pnpm test`
Expected: clean for these files.

- [ ] **Step 4: Commit**

```bash
git add src/runtime/server/vtex-helper/checkoutUrl.ts src/runtime/server/orchestr/cart/base.resolver.ts
git commit -m "feat: resolve the canonical Cart components from the orderForm"
```

---

### Task 7: The CartItem resolver and its product-variant link

**Files:**
- Create: `src/runtime/server/orchestr/cart-item/base.resolver.ts`
- Create: `src/runtime/server/orchestr/cart-item/product-variant.link.ts`

**Interfaces:**
- Consumes: `orderFormToken` (Task 5); the `toCartItem*` mappers and `currencyOf` (Task 4).

- [ ] **Step 1: Write the resolver**

Create `src/runtime/server/orchestr/cart-item/base.resolver.ts`:

```ts
import {
  CartItemAvailability,
  CartItemBase,
  CartItemCost,
  CartItemProductData,
  CartItemQuantityRule,
} from '@laioutr-core/canonical-types/entity/cart-item';
import { orderFormToken } from '../../const/passthroughTokens';
import { defineVtexComponentResolver } from '../../middleware/defineVtex';
import {
  currencyOf,
  toCartItemAvailability,
  toCartItemBase,
  toCartItemCost,
  toCartItemQuantityRule,
} from '../../vtex-helper/mappers/cart';

export default defineVtexComponentResolver({
  label: 'VTEX Cart Item Connector',
  entityType: 'CartItem',
  provides: [
    CartItemBase,
    CartItemCost,
    CartItemProductData,
    CartItemAvailability,
    CartItemQuantityRule,
  ],
  resolve: async ({ entityIds, passthrough, $entity }) => {
    const orderForm = passthrough.get(orderFormToken);
    if (!orderForm) return { entities: [] };

    const currency = currencyOf(orderForm);
    const byUniqueId = new Map(orderForm.items.map((line) => [line.uniqueId, line]));

    // Guarding per line, not around the loop: a line VTEX returns in an unusable shape costs that
    // line, never the whole cart.
    const entities = entityIds.flatMap((id) => {
      const line = byUniqueId.get(id);
      if (!line) return [];

      const cost = currency ? toCartItemCost(line, currency) : undefined;
      if (!cost) {
        console.warn(`[app-vtex] cart line ${id} has no expressible cost; dropping the line`);
        return [];
      }

      return [
        $entity({
          id,
          base: () => toCartItemBase(line),
          cost: () => cost,
          // VTEX carries a measurement unit but no base-unit price, so there is nothing to report.
          productData: () => undefined,
          availability: () => toCartItemAvailability(line),
          quantityRule: () => toCartItemQuantityRule(line),
        }),
      ];
    });

    return { entities };
  },
});
```

- [ ] **Step 2: Write the product-variant link**

Create `src/runtime/server/orchestr/cart-item/product-variant.link.ts`:

```ts
import { CartItemProductVariantLink } from '@laioutr-core/canonical-types/ecommerce';
import { orderFormToken } from '../../const/passthroughTokens';
import { defineVtexLink } from '../../middleware/defineVtex';

export default defineVtexLink({
  implements: CartItemProductVariantLink,
  run: async ({ entityIds, passthrough }) => {
    const orderForm = passthrough.get(orderFormToken);
    if (!orderForm) return { links: [] };

    const byUniqueId = new Map(orderForm.items.map((line) => [line.uniqueId, line]));

    // A VTEX SKU id is a canonical ProductVariant id, so the line already carries the target.
    return {
      links: entityIds.flatMap((sourceId) => {
        const line = byUniqueId.get(sourceId);
        return line ? [{ sourceId, targetId: line.id }] : [];
      }),
    };
  },
});
```

- [ ] **Step 3: Verify**

Run: `pnpm dev:prepare && pnpm lint && pnpm test`
Expected: clean for these files.

- [ ] **Step 4: Commit**

```bash
git add src/runtime/server/orchestr/cart-item/
git commit -m "feat: resolve cart items and link them to their product variants"
```

---

### Task 8: Add items to the cart

**Files:**
- Modify: `src/runtime/server/vtex-helper/mappers/product.ts` (add `defaultSellerIdOf` beside `defaultOfferOf`)
- Modify: `src/runtime/server/vtex-helper/mappers/product.test.ts`
- Create: `src/runtime/server/orchestr/cart/add-items.action.ts`

**Interfaces:**
- Consumes: `searchByIds` from `vtex-helper/searchByIds`; `createOrderForm`, `clearMessagesAndRead`, `parseOrderFormId`, `toBatchResults` (Task 3).
- Produces: `defaultSellerIdOf(item: { sellers?: VtexSeller[] }): string | undefined`.

- [ ] **Step 1: Write the failing seller test**

Append to `src/runtime/server/vtex-helper/mappers/product.test.ts`:

```ts
import { defaultSellerIdOf } from './product';

describe('defaultSellerIdOf', () => {
  it('takes the only seller when a SKU has one', () => {
    expect(defaultSellerIdOf({ sellers: [{ sellerId: '1', commertialOffer: { Price: 1, ListPrice: null, AvailableQuantity: 1 } }] })).toBe('1');
  });

  it('takes the flagged default when a marketplace SKU has several', () => {
    expect(
      defaultSellerIdOf({
        sellers: [
          { sellerId: '2', commertialOffer: { Price: 1, ListPrice: null, AvailableQuantity: 1 } },
          { sellerId: '3', sellerDefault: true, commertialOffer: { Price: 1, ListPrice: null, AvailableQuantity: 1 } },
        ],
      })
    ).toBe('3');
  });

  it('is undefined when several sellers compete and none is flagged, because picking one picks a price', () => {
    expect(
      defaultSellerIdOf({
        sellers: [
          { sellerId: '2', commertialOffer: { Price: 1, ListPrice: null, AvailableQuantity: 1 } },
          { sellerId: '3', commertialOffer: { Price: 1, ListPrice: null, AvailableQuantity: 1 } },
        ],
      })
    ).toBeUndefined();
  });

  it('is undefined when the SKU has no sellers at all', () => {
    expect(defaultSellerIdOf({})).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/runtime/server/vtex-helper/mappers/product.test.ts`
Expected: FAIL — `defaultSellerIdOf is not a function`.

- [ ] **Step 3: Implement the seller lookup**

Add to `src/runtime/server/vtex-helper/mappers/product.ts`, directly below `defaultOfferOf`:

```ts
/**
 * The seller an add-to-cart transacts against. A lone seller is unambiguous; several are only
 * resolvable through VTEX's own flag, and guessing among them would decide the shopper's price.
 */
export const defaultSellerIdOf = (item: { sellers?: VtexSeller[] }): string | undefined => {
  const sellers = item.sellers ?? [];
  if (sellers.length === 1) return sellers[0]?.sellerId;
  return sellers.find((seller) => seller.sellerDefault)?.sellerId;
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/runtime/server/vtex-helper/mappers/product.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the action**

Create `src/runtime/server/orchestr/cart/add-items.action.ts`:

```ts
import { CartAddItemsAction } from '@laioutr-core/canonical-types/ecommerce';
import type { CartBatchResultItem } from '../../vtex-helper/orderForm';
import type { VtexOrderItemAdd } from '../../types/vtexCheckout';
import { getCookie } from '#imports';
import { CHECKOUT_ORDER_FORM } from '../../client/cookies';
import { defineVtexAction } from '../../middleware/defineVtex';
import { defaultSellerIdOf } from '../../vtex-helper/mappers/product';
import {
  clearMessagesAndRead,
  createOrderForm,
  parseOrderFormId,
  toBatchResults,
} from '../../vtex-helper/orderForm';
import { searchByIds } from '../../vtex-helper/searchByIds';

export default defineVtexAction(CartAddItemsAction, async ({ input, context, event }) => {
  const { vtexClient, vtexSalesChannel } = context;

  const productRows = input.filter((row) => row.type === 'product');
  const unsupported: CartBatchResultItem[] = input
    .filter((row) => row.type !== 'product')
    .map((row) => ({
      status: 'rejected',
      sku: row.type === 'sku' ? row.sku : undefined,
      reason: 'not-supported',
    }));

  if (productRows.length === 0) return { items: unsupported };

  // Creating one writes no cookie here on purpose: VTEX answers with a `Set-Cookie` and the client
  // already forwards it to the managed-cookie writer.
  const existingId = parseOrderFormId(getCookie(event, CHECKOUT_ORDER_FORM));
  const before =
    existingId ?
      await clearMessagesAndRead(vtexClient, existingId)
    : await createOrderForm(vtexClient);

  // One search for every row: VTEX refuses an add with no seller, and the canonical input has no
  // field for one. A wholesale failure here throws rather than falling back, because every
  // available fallback decides which offer the shopper is charged for.
  const products = await searchByIds(
    vtexClient,
    'skuId',
    productRows.map((row) => row.variantId)
  );
  const sellerBySku = new Map(
    products.flatMap((product) => product.items.map((item) => [item.itemId, defaultSellerIdOf(item)]))
  );

  const orderItems: VtexOrderItemAdd[] = [];
  const unorderable: CartBatchResultItem[] = [];

  for (const row of productRows) {
    const seller = sellerBySku.get(row.variantId);
    if (!seller) {
      unorderable.push({
        status: 'rejected',
        productId: row.productId,
        variantId: row.variantId,
        reason: sellerBySku.has(row.variantId) ? 'not-orderable' : 'not-found',
      });
      continue;
    }

    orderItems.push({ id: row.variantId, quantity: row.quantity, seller });
  }

  if (orderItems.length === 0) return { items: [...unsupported, ...unorderable] };

  const after = await vtexClient.publicFetch<typeof before>(
    'checkout',
    `/api/checkout/pub/orderForm/${encodeURIComponent(before.orderFormId)}/items?sc=${vtexSalesChannel}`,
    { method: 'POST', body: JSON.stringify({ orderItems }) }
  );

  const requested = productRows
    .filter((row) => sellerBySku.get(row.variantId))
    .map((row) => ({ productId: row.productId, variantId: row.variantId }));

  // The updated cart reaches the storefront through the next cart query: an action has no
  // passthrough store to hand it back through.
  return { items: [...unsupported, ...unorderable, ...toBatchResults(requested, before, after)] };
});
```

- [ ] **Step 6: Verify**

Run: `pnpm dev:prepare && pnpm lint && pnpm test`
Expected: clean for these files.

- [ ] **Step 7: Commit**

```bash
git add src/runtime/server/vtex-helper/mappers/product.ts src/runtime/server/vtex-helper/mappers/product.test.ts src/runtime/server/orchestr/cart/add-items.action.ts
git commit -m "feat: add product items to the VTEX cart"
```

---

### Task 9: Update and remove cart items

**Files:**
- Create: `src/runtime/server/orchestr/cart/update-items.action.ts`
- Create: `src/runtime/server/orchestr/cart/remove-items.action.ts`

**Interfaces:**
- Consumes: `parseOrderFormId`, `clearMessagesAndRead`, `indexByUniqueId`, `toOrderItemUpdates` (Task 3).

- [ ] **Step 1: Write the update action**

Create `src/runtime/server/orchestr/cart/update-items.action.ts`:

```ts
import { CartUpdateItemsAction } from '@laioutr-core/canonical-types/ecommerce';
import { getCookie } from '#imports';
import { CHECKOUT_ORDER_FORM } from '../../client/cookies';
import { defineVtexAction } from '../../middleware/defineVtex';
import {
  clearMessagesAndRead,
  indexByUniqueId,
  parseOrderFormId,
  toOrderItemUpdates,
} from '../../vtex-helper/orderForm';

export default defineVtexAction(CartUpdateItemsAction, async ({ input, context, event }) => {
  const orderFormId = parseOrderFormId(getCookie(event, CHECKOUT_ORDER_FORM));
  if (!orderFormId) throw new Error('Cannot update a cart the shopper does not have');

  // Clearing first is what makes the messages on the response belong to this call; the snapshot it
  // returns is also the only thing that can turn a uniqueId into the index VTEX demands.
  const snapshot = await clearMessagesAndRead(context.vtexClient, orderFormId);
  const orderItems = toOrderItemUpdates(input, indexByUniqueId(snapshot));
  if (orderItems.length === 0) return;

  // `customFields` are dropped: VTEX has no per-line equivalent, and the token defines unsupported
  // features as ignored rather than as failures.
  await context.vtexClient.publicFetch(
    'checkout',
    `/api/checkout/pub/orderForm/${encodeURIComponent(orderFormId)}/items/update?sc=${context.vtexSalesChannel}`,
    { method: 'POST', body: JSON.stringify({ orderItems }) }
  );
});
```

- [ ] **Step 2: Write the remove action**

Create `src/runtime/server/orchestr/cart/remove-items.action.ts`:

```ts
import { CartRemoveItemsAction } from '@laioutr-core/canonical-types/ecommerce';
import { getCookie } from '#imports';
import { CHECKOUT_ORDER_FORM } from '../../client/cookies';
import { defineVtexAction } from '../../middleware/defineVtex';
import {
  clearMessagesAndRead,
  indexByUniqueId,
  parseOrderFormId,
  toOrderItemUpdates,
} from '../../vtex-helper/orderForm';

export default defineVtexAction(CartRemoveItemsAction, async ({ input, context, event }) => {
  const orderFormId = parseOrderFormId(getCookie(event, CHECKOUT_ORDER_FORM));
  if (!orderFormId) throw new Error('Cannot remove from a cart the shopper does not have');

  const snapshot = await clearMessagesAndRead(context.vtexClient, orderFormId);
  const orderItems = toOrderItemUpdates(
    input.map((itemId) => ({ itemId, quantity: 0 })),
    indexByUniqueId(snapshot)
  );
  if (orderItems.length === 0) return;

  // Every index goes in one payload: VTEX applies them against the positions this snapshot has, so
  // issuing them one at a time would delete by indices the earlier removals had already shifted.
  await context.vtexClient.publicFetch(
    'checkout',
    `/api/checkout/pub/orderForm/${encodeURIComponent(orderFormId)}/items/update?sc=${context.vtexSalesChannel}`,
    { method: 'POST', body: JSON.stringify({ orderItems }) }
  );
});
```

- [ ] **Step 3: Verify**

Run: `pnpm dev:prepare && pnpm lint && pnpm test`
Expected: clean for these files.

- [ ] **Step 4: Commit**

```bash
git add src/runtime/server/orchestr/cart/update-items.action.ts src/runtime/server/orchestr/cart/remove-items.action.ts
git commit -m "feat: update and remove VTEX cart items by their stable line id"
```

---

### Task 10: The checkout URL

**Files:**
- Create: `src/runtime/server/orchestr/cart/get-checkout-url.action.ts`
- Test: `src/runtime/server/vtex-helper/checkoutUrl.test.ts`

**Interfaces:**
- Consumes: `checkoutUrlFor` from `vtex-helper/checkoutUrl` (created in Task 6, Step 1).

- [ ] **Step 1: Write the failing test**

Create `src/runtime/server/vtex-helper/checkoutUrl.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { checkoutUrlFor } from './checkoutUrl';

describe('checkoutUrlFor', () => {
  it('carries the orderForm id, because VTEX s domain cannot read our cookie', () => {
    expect(checkoutUrlFor('laioutrpartner', 'vtexcommercestable', 'OF1')).toBe(
      'https://laioutrpartner.vtexcommercestable.com.br/checkout/?orderFormId=OF1#/cart'
    );
  });

  it('falls back to a bare checkout when the shopper has no cart', () => {
    expect(checkoutUrlFor('laioutrpartner', 'vtexcommercestable')).toBe(
      'https://laioutrpartner.vtexcommercestable.com.br/checkout/#/cart'
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `pnpm vitest run src/runtime/server/vtex-helper/checkoutUrl.test.ts`
Expected: PASS — the module landed in Task 6. If Task 6 has not run, create `checkoutUrl.ts` from its Step 1 first.

- [ ] **Step 3: Write the action**

Create `src/runtime/server/orchestr/cart/get-checkout-url.action.ts`:

```ts
import { GetCheckoutUrlAction } from '@laioutr-core/canonical-types/ecommerce';
import { getCookie, useRuntimeConfig } from '#imports';
import { name } from '../../../../../package.json';
import { CHECKOUT_ORDER_FORM } from '../../client/cookies';
import { defineVtexAction } from '../../middleware/defineVtex';
import { checkoutUrlFor } from '../../vtex-helper/checkoutUrl';
import { parseOrderFormId } from '../../vtex-helper/orderForm';

export default defineVtexAction(GetCheckoutUrlAction, async ({ event }) => {
  const config = useRuntimeConfig()[name] as { accountName: string; environment: string };

  return {
    checkoutUrl: checkoutUrlFor(
      config.accountName,
      config.environment,
      parseOrderFormId(getCookie(event, CHECKOUT_ORDER_FORM))
    ),
  };
});
```

- [ ] **Step 4: Verify**

Run: `pnpm dev:prepare && pnpm lint && pnpm test`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/server/vtex-helper/checkoutUrl.test.ts src/runtime/server/orchestr/cart/get-checkout-url.action.ts
git commit -m "feat: hand the shopper a checkout url bound to their orderForm"
```

---

### Task 11: A playground page that exercises the whole flow

Mocked-fetch tests confirm my assumptions about VTEX, not VTEX. This page is what catches the three things they cannot: the cart cookie surviving a real browser round trip, index resolution staying right after a removal reorders the remaining lines, and VTEX's checkout adopting the orderForm from the URL.

**Files:**
- Create: `playground/pages/cart.vue`

**Interfaces:**
- Consumes: `fetchAction` (auto-imported from `@laioutr-core/orchestr`), and the canonical cart tokens.

- [ ] **Step 1: Write the page**

Create `playground/pages/cart.vue`. Deliberately unstyled — it is a probe, not a component:

```vue
<script setup lang="ts">
import {
  CartAddItemsAction,
  CartRemoveItemsAction,
  CartUpdateItemsAction,
  GetCheckoutUrlAction,
} from '@laioutr-core/canonical-types/ecommerce';

// Both SKUs of the test fixture, so a removal has a sibling line whose index must shift.
const skus = [
  { productId: '137327', variantId: '756290', label: 'Test Sneaker Rot 42' },
  { productId: '137327', variantId: '756291', label: 'Test Sneaker Blau 43' },
];

const cart = ref<any>(null);
const log = ref<string[]>([]);

const load = async () => {
  const response = await $fetch<any>('/api/orchestr/query', {
    method: 'POST',
    body: {
      queries: [
        {
          id: 'cart',
          queryName: 'ecommerce/cart/get-current',
          arguments: {},
          components: ['base', 'cost'],
          links: { 'ecommerce/cart/cart-items': { components: ['base', 'cost', 'availability'] } },
        },
      ],
    },
  });
  cart.value = response;
  log.value.unshift(`loaded ${new Date().toISOString()}`);
};

const add = async (sku: (typeof skus)[number]) => {
  const result = await fetchAction(CartAddItemsAction, [
    { type: 'product', productId: sku.productId, variantId: sku.variantId, quantity: 1 },
  ]);
  log.value.unshift(`add → ${JSON.stringify(result)}`);
  await load();
};

const setQuantity = async (itemId: string, quantity: number) => {
  await fetchAction(CartUpdateItemsAction, [{ itemId, quantity }]);
  log.value.unshift(`update ${itemId} → ${quantity}`);
  await load();
};

const remove = async (itemId: string) => {
  await fetchAction(CartRemoveItemsAction, [itemId]);
  log.value.unshift(`remove ${itemId}`);
  await load();
};

const goToCheckout = async () => {
  const { checkoutUrl } = await fetchAction(GetCheckoutUrlAction);
  log.value.unshift(`checkout → ${checkoutUrl}`);
  window.location.href = checkoutUrl;
};

onMounted(load);
</script>

<template>
  <div>
    <h1>VTEX cart probe</h1>

    <p>
      <button v-for="sku in skus" :key="sku.variantId" type="button" @click="add(sku)">
        add {{ sku.label }}
      </button>
      <button type="button" @click="load">reload</button>
      <button type="button" @click="goToCheckout">checkout</button>
    </p>

    <pre>{{ JSON.stringify(cart, null, 2) }}</pre>

    <h2>log</h2>
    <ol>
      <li v-for="(entry, index) in log" :key="index">{{ entry }}</li>
    </ol>
  </div>
</template>
```

- [ ] **Step 2: Run the flow in a browser**

```bash
pnpm dev
```

Open `http://localhost:3000/cart` and walk through it, checking each in turn:

1. **The cookie survives.** In devtools → Application → Cookies, `checkout.vtex.com` is present on `localhost`, `HttpOnly`, `SameSite=Lax`. Its value is percent-encoded (`__ofid%3D…`) — that is expected, h3 decodes it on read. *Before Task 1 this cookie was absent; if it is absent now, Task 1 regressed.*
2. **The cart persists.** Reload the page. The items are still there.
3. **Index resolution holds.** Add both SKUs, then remove the **first**. The second must survive with its quantity intact. Removing the first and finding the second gone means `uniqueId` resolution broke and indices are being used raw.
4. **Quantities clamp rather than error.** Set a quantity of 9999 through the update button path. The response is not an error and the line lands at VTEX's cap.
5. **Checkout adopts the cart.** Click checkout. VTEX's checkout page shows the same items.
6. **The Studio preview frame keeps its cart.** If a Studio preview is available for this project, open the page inside it and confirm the cart is not empty — that is the `SameSite=None; Partitioned` path.

- [ ] **Step 3: Commit**

```bash
git add playground/pages/cart.vue
git commit -m "chore: add a playground page exercising the cart flow"
```

---

### Task 12: Changeset and README

**Files:**
- Create: `.changeset/<generated-name>.md`
- Modify: `README.md:39-42`

**Interfaces:** none.

- [ ] **Step 1: Write the changeset**

Run `pnpm changeset`, pick a **minor** bump, and write the entry for the package consumer — not for the contributor. Every file in `.changeset/` ships as one changelog section, so describe the feature at release rather than the increment this work added:

```markdown
---
'@laioutr/app-vtex': minor
---

**Cart** — the VTEX Checkout orderForm behind the canonical `Cart` and `CartItem` entities. Read the
current cart, add product items, change quantities, remove lines, and send the shopper to VTEX's
checkout. A cart is created on the first add rather than on first sight, so a visitor who never
shops is never given one.

Also fixes VTEX session cookies being dropped by the browser: they were passed through carrying
VTEX's own domain, which no browser accepts on the storefront's origin. Nothing depended on them
before the cart did.

Discount codes, SKU quick-order rows and custom line items are reported as rejected rather than
silently ignored; VTEX shipping, addresses and coupons are not covered yet.
```

- [ ] **Step 2: Update the README feature list**

In `README.md`, move cart out of the "Not yet built" line and add a bullet to the feature list:

```markdown
- **Cart** — the Checkout orderForm as canonical `Cart` and `CartItem`: read, add, update quantity,
  remove, and a checkout URL bound to the orderForm. A cart is minted on the first add, not on the
  first page view. Line items are addressed by VTEX's stable `uniqueId`; the positional index the
  Checkout API demands is resolved per mutation, because indices shift when a line is removed.
```

And change the closing line to:

```markdown
Not yet built: checkout, authentication, customer, orders and reviews. See
```

- [ ] **Step 3: Verify the whole suite one last time**

Run: `pnpm dev:prepare && pnpm lint && pnpm test`
Expected: all green. `pnpm test:types` still shows only the two pre-existing `globalExtensions.ts` TS2717 errors.

- [ ] **Step 4: Commit**

```bash
git add .changeset README.md
git commit -m "docs: describe the cart in the readme and changeset"
```
