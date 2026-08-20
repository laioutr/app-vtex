# Environment and project state

Operational context that is not derivable from the code or the git history. The implementation
plan lives in [`docs/plans/2026-08-20-vtex-wrapper-plan.md`](./plans/2026-08-20-vtex-wrapper-plan.md);
this file records the state of the systems around it.

Last verified: 2026-08-20.

## VTEX sandbox

Partner account `laioutrpartner`, environment `vtexcommercestable`, store currency **EUR**.
Credentials live in a gitignored `.env`; `.env.example` documents the shape. They are AppKey/
AppToken with full admin scope — treat them as production-grade secrets.

### Hosts

There is no single base URL. Verified against the live account:

| Host | APIs |
|---|---|
| `https://{account}.vtexcommercestable.com.br` | Catalog, Catalog System, Checkout, Logistics, VTEX ID, Portal/Pagetype, Reviews |
| `https://api.vtex.com/{account}` | Pricing |

`logistics.vtexcommercestable.com.br` returns 401; the same path on the account domain returns 200.

### Catalog contents

The catalog is nearly empty — **two products, one of which has no SKUs at all**. Only product
`146835` is usable:

- "Slip On Sneaker" / `FILA Slip On Sneaker - Weiß`, single SKU `146835`
- slug `slip-on-sneaker` (note: `LinkId` is `Slip-On-Sneaker`; the resolvable slug is the
  lowercase `linkText`)
- category path `/Damen/Schuhe/Sneaker/Slip On Sneaker/` (`CategoryId` 5, all levels active)
- warehouse `1_1` "Hauptbestand", 100 units, `basePrice` 49.99, seller `1`

Expect thin coverage for category listings, search facets and cart flows until a real demo
dataset exists. Getting one is worth doing before the cart and PLP work.

### Changes made to the account

The SKU shipped inactive, which is why nothing was searchable or purchasable. To make it usable:

1. **Attached a placeholder image** (file id `449`, `https://placehold.co/400x400.png`). VTEX
   refuses to activate a SKU with no files. **This is a stand-in and should be replaced with a
   real product image.** VTEX's file-insert-by-URL returned a 500 SQL timeout on the first
   attempt and succeeded on retry — that endpoint is flaky, so retry before concluding failure.
2. **Set `IsActive: true`** on SKU `146835` via `PUT /api/catalog/pvt/stockkeepingunit/146835`.

Nothing else on the account was modified.

### API traps found the hard way

- `fq=skuId:{id}` **does not filter** — it returns an empty list. Use `fq=productId:{id}`.
- `products/search` with no `fq` also returns empty. It is not a catalog dump; use
  `GET /api/catalog_system/pvt/products/GetProductAndSkuIds` `[adminFetch]` for enumeration.
- The slug path is case-sensitive and returns an **empty result rather than a 404** for the wrong
  casing, which reads exactly like "not indexed". It is not.
- `GET /api/catalog_system/pvt/products/GetIndexedInfo/{productId}` is the only indexing endpoint
  in the Catalog spec and returns raw Solr XML. It is the fastest way to tell a data problem from
  a query problem.
- **Intelligent Search is not available on this account.** Every endpoint
  (`product_search`, `facets`, `search_suggestions`, `top_searches`) returns HTTP 400 with
  `"Store is not active."` — including with a valid query term, so this is store provisioning, not
  a parameter problem. An earlier note here blamed the empty query; that was wrong.
- Legacy Search covers the gap for search and listing but **not autocomplete**:
  - full text: `products/search/{term}` or `products/search?ft={term}`
  - category listing: `products/search?fq=C:/{categoryPath}/`
  - facets: `facets/search/{term}?map=ft` and `facets/category/{id}` — `map` is **required**, and
    omitting it is the 400 it looks like. Returns `Departments`, `Brands`, `CategoriesTrees`,
    `PriceRanges`.
  - there is no legacy equivalent for suggestions or top searches.
- Sales channels enumerate only on the **private** path: `GET /api/catalog_system/pvt/saleschannel/list`
  `[adminFetch]` returns 200, while the `pub` variant of that path does not exist and 404s.
  This account has exactly one channel: id `1`, "Main", `EUR`, active.

## npm

`@laioutr/app-vtex@0.1.0` is published to npmjs.org (bootstrap publish, `--no-provenance`, done by
hand because trusted publishing needs the package to exist first).

**Still outstanding:** configure the trusted publisher on the package's npm settings page —
GitHub Actions, this repository, workflow `release.yml`. Until that is done `release.yml` cannot
publish. Repository secrets `NPM_LAIOUTR_TOKEN` and `RELEASE_TOKEN` are already configured.

## CI

Both jobs pass as of the current branch. Three inherited defects had to be fixed first, all of
which still affect any app forked from `app-starter`:

1. `playground/nuxt.config.ts` imported the gitignored `laioutrrc.json` directly, so `dev:prepare`
   died in CI and on any fresh clone. Now read through `existsSync` with an empty-object fallback.
2. `test/basic.test.ts` asserted `<div>basic</div>`, which the fixture never renders — it mounts
   `<LfcApp />`.
3. `pnpm-lock.yaml` was out of step with `package.json`, and CI installs with `--frozen-lockfile`.

**`app-starter`'s own `main` has been red since 2026-08-13** for reason 3. Reasons 1 and 3 are
still unfixed upstream, as is the malformed indentation in its `package.json` (`],` and
`"scripts": {` sit at column 0). Porting these back would spare every future app the same day.

## Known-broken, deliberately not fixed

`pnpm test:types` reports two errors inherited from the template. `test:types` is **not** part of
CI, so they do not block anything, but they will greet anyone who runs it:

- `src/globalExtensions.ts` TS2717 ×2 — the module augmentation collides with Nuxt's generated
  `.nuxt/types/schema.d.ts`, which declares the same key. Reproduces identically in `app-starter`.

A third inherited error — `defineNitroPlugin` unresolved in `zodFix.ts` — is gone. Server runtime
code resolves `#imports` against `.nuxt/types/nitro-imports.d.ts`, which the root tsconfig does not
use, so `src/runtime/server` is excluded there and checked through its own
`src/runtime/server/tsconfig.json` instead. `test:types` runs both projects.
