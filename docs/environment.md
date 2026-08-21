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

- `fq=skuId:{id}` works as a **lookup**, returning the SKU's whole parent product with every
  sibling item. It does not narrow the response to that one SKU, so pick the item out by `itemId`.
- `products/search` with no `fq` returns **the catalog, capped by `_to`** — 43 products on this
  account. An earlier note here said it returns empty; that was true only while nothing was
  indexed. It is not a safe fallback: a handler that drops its filter silently reports every
  product instead of failing, so guard the filter before the call. Enumerate deliberately with
  `GET /api/catalog_system/pvt/products/GetProductAndSkuIds` `[adminFetch]`, whose `_from`/`_to`
  range is 1-indexed and inclusive at both ends.
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
  - category listing: `products/search?fq=C:{a}/{b}/{c}` — the id path with **no leading and no
    trailing slash**. The other spellings fail in different ways: `fq=C:/1` answers 400, and
    `fq=C:/1/2/3/` answers **200 with an empty list**, so a trailing slash reads as "this category
    has no products". A single segment tolerates both (`C:1` and `C:/1/` agree); nested paths do
    not. An unknown category id answers 400.
  - facets: `facets/search/{term}?map=ft` and `facets/category/{id}` — `map` is **required**, and
    omitting it is the 400 it looks like. Returns `Departments`, `Brands`, `CategoriesTrees`,
    `PriceRanges`.
  - there is no legacy equivalent for suggestions or top searches.
- Category names are **not unique** — this catalog carries three separate "Sport", "Bekleidung",
  "Hosen" and "T-Shirts & Tops" categories under Damen, Herren and Kinder, and two "Schuhe". A
  category slug is therefore its whole URL path (`herren/schuhe`), never the last segment.
- The category tree node carries `Title` and `MetaTagDescription` alongside `name`, but no
  description, so `CategoryContent` has no source here. `Title` is null on root categories.
- **There is no reindex endpoint on this account** — `/api/catalog/pvt/indexingstatus` and the
  per-product reindex paths all 404. To re-enqueue a product, GET it and PUT the identical payload
  back to `/api/catalog/pvt/product/{id}` `[adminFetch]`; indexing follows within minutes. Category
  assignments propagate later than the product itself, so a product can be findable by `ft=` while
  `fq=C:` still misses it.
- `GET /api/catalog_system/pvt/sku/stockkeepingunitbyid/{skuId}` is a **lagging read-model**: it
  reported a SKU as inactive with no images or specifications minutes after all three were set and
  confirmed. `GET /api/catalog/pvt/stockkeepingunit/{skuId}` and its `/specification` and `/file`
  sub-resources are authoritative — check those before concluding a write failed.
- Assigning a specification takes a **scalar** `FieldValueId`. An array answers 400 with an empty
  body, which reads like a malformed request rather than a wrong field type:
  `POST /api/catalog/pvt/product/{id}/specification` and
  `POST /api/catalog/pvt/stockkeepingunit/{id}/specification`, body `{FieldId, FieldValueId, Text}`.
- `fq=productId:{id}` **needs an explicit `_from`/`_to`**. Without one it answers 200 with an empty
  list for some products and correctly for others; with `_from=0&_to={n-1}` it answers 206 and is
  reliable at every batch size tested (1-11 ids). The empty answer is indistinguishable from "no
  such product", so never omit the window.
- Indexing lands in stages, and a product is reachable by some queries before others: the slug path
  `products/search/{slug}/p` resolved a new product while `categoriesFullPath` was still empty in
  the index and `fq=C:` therefore missed it. A freshly created product can resolve its detail-page
  id and still have no listing presence for a while.
- Writes to this account **fail transiently with an empty 500** and succeed on retry — seen on
  specification and file creation. Retry before treating one as a real failure.
### Official API types

VTEX publishes OpenAPI 3.0 schemas at [`vtex/openapi-schemas`](https://github.com/vtex/openapi-schemas),
synced to the developer portal. `VTEX - Search API.json` is the Legacy Search surface this app reads,
and its response schemas are fully typed down to `sellers[].commertialOffer`. It is a far better
source than the hand-written interfaces in `vtex-helper/mappers/`, and `openapi-typescript` can
generate from it — the same shape `app-shopware` gets from `@shopware/api-client`.

`pnpm types:vtex` regenerates `src/runtime/server/types/vtexCatalogTypes.d.ts` from
`https://developers.vtex.com/api/openapi/catalog-api`, and `types/vtexCatalog.ts` names the shapes
worth reaching for. The instance itself publishes nothing: `/swagger.json`, `/openapi.json` and
`/_v/openapi` all answer with the storefront's HTML, so the portal is the only source.

**Not every VTEX schema is worth generating from.** Judge one by whether its component schemas are
authored or scraped from a sample response:

| spec | paths | schemas | verdict |
| --- | --- | --- | --- |
| Catalog API | 152 | 42 | authored — generated and committed |
| Logistics API | 46 | 4 | authored, but mostly inline shapes |
| Reviews and Ratings API | 4 | 2 | authored |
| Checkout API | 37 | 8 | authored |
| VTEX ID | 14 | 2 | authored |
| Legacy Search API | 15 | 25 | **scraped — do not generate** |

The Legacy Search schema is built from example payloads, and it shows: schemas named `Example`,
`Example2`, `generatedObject`, and — leaked from a sample television — `ResoluO`, `TamanhoDaTela`
and `AplicativosDeTV`. Its `Item` carries `COR` and `TAMANHO` as literal properties, which are one
product's option axes rather than a contract. It also contradicts itself, describing the product
with 9 properties as a named schema and 22 inline on the path. `VtexProduct` stays hand-written for
that reason.

Two caveats before trusting a generated type outright:

- **A schema can be optimistic about nulls.** `GetCategoryTree` marks `Title` and
  `MetaTagDescription` as required strings; root categories return null for the first and every
  category returns null for the second. `VtexCategoryNode` derives from the generated type and
  corrects exactly those two, in the open.
- **The Legacy Search schema disagrees with itself about `variations`** — present on the named
  `Item` schema, absent from the inline path schema, and returned by the live API.
- **The npm SDKs are not an option.** `@vtex/clients` peer-depends on `@vtex/api` 6.x while that
  package ships 7.4.2, and `@vtex/api` is a VTEX IO server runtime pulling koa, archiver, tar-fs,
  bluebird, graphql 14 and a `github:` dependency. It is for building IO apps, not for reading a
  catalog from outside.

The spec is worth reading even where it is not generated from: `sellers[].sellerDefault` is
documented there and present in live responses, which is how a marketplace SKU names the offer the
storefront transacts against rather than whichever seller happens to come first.

### GraphQL is available on this account

`POST /api/io/_v/public/graphql/v1` is live and answers with `AppKey`/`AppToken` auth. Three VTEX IO
apps are mounted: `vtex.store-graphql@2.177.3`, `vtex.search-graphql@0.72.0` and
`vtex.catalog-graphql@1.106.1`. The bare `/_v/public/graphql/v1` path 403s — only the `/api/io/`
form works. Every query needs `@context(provider: "vtex.store-graphql")`, because several apps
define `product` and the ambiguity is a 500.

What works, verified:

- `product(identifier: {field: id, value: "285"})` — `field` is an **enum**, so `id` is unquoted;
  quoting it fails validation with no detail.
- `productsByIdentifier(field: id, values: ["285", "305"])` — batch hydration by id, which is the
  shape a component resolver needs.
- `productSearch(query: "1", map: "c", from: 0, to: 9)` under the **store-graphql** provider, which
  proxies Legacy Search.

What does not, and why:

- Anything under `vtex.search-graphql` — `productSearch`, `facets` — answers 400 through the proxy,
  matching Intelligent Search being inactive on this account.
- `products(category:)` answers 500. Introspection is disabled: `__schema` and `__type` both fail
  validation, so the schema has to be probed by trial.

Field selection is the reason to care. Measured over the same five products:

| request | bytes |
| --- | --- |
| REST `products/search` | 140,827 |
| GraphQL, every field the mappers read | 32,682 |
| GraphQL, prices only | 2,234 |

Errors arrive as **HTTP 200 with an `errors` array**, so a client that keys failure off the status
code — as `VtexApiError` does — reads a failed query as success.

**Smaller is not faster.** Measured against a healthy account, 48 products, 10 interleaved reps:

| request | median | bytes |
| --- | --- | --- |
| REST `products/search`, everything | 638 ms | 1,142,689 |
| GraphQL, every field the mappers read | 1,017 ms | 255,012 |
| GraphQL, prices and stock only | 651 ms | 32,053 |

The IO hop costs roughly what the bandwidth saves. Fetching a thirty-sixth of the bytes lands
within noise of the full REST response, and asking GraphQL for everything is materially *slower*
than REST. So the case for GraphQL here is egress and the CPU spent parsing a megabyte per
listing, not latency — do not expect a page to render faster for it.

Timings taken from outside the datacenter, on an account a second session was also using; treat
the ordering as sound and the absolute numbers as soft.

**Sales channel: still unresolved, and it cannot be settled on this account.** What is established:
the `sc` query parameter is **ignored** — `?sc=999`, a channel that does not exist, returns the
same product at the same price as `?sc=1` and as no parameter at all — and `product` accepts no
`salesChannel` argument. A hand-made `vtex_segment` cookie changed nothing either, but VTEX
validates segment tokens, so that leg proves little.

The account has exactly one channel, so "scopes to the default channel" and "does not scope"
predict identical results; a per-product comparison against the `sc=1` REST search agreed on all
20 products sampled, which distinguishes nothing. Settling it needs a second sales channel
carrying a different price for one SKU. Until then, assume nothing about channel scoping before
moving a read onto GraphQL.

- Sales channels enumerate only on the **private** path: `GET /api/catalog_system/pvt/saleschannel/list`
  `[adminFetch]` returns 200, while the `pub` variant of that path does not exist and 404s.
  This account has exactly one channel: id `1`, "Main", `EUR`, active.

### Test fixture: product 137327

`Laioutr Test Sneaker` (`laioutr-test-sneaker`) exists to exercise the two mapping paths the seeded
catalog leaves empty — SKU option axes and product specifications. It sits in category 8
(`herren/schuhe/sneaker/flache-sneaker`) and carries:

- specification group 5 "Laioutr Test Attributes" on category 8, with fields `Farbe` (20),
  `Groesse` (18) and `Material` (19)
- SKU 756290 — Farbe Rot, Groesse 42, **59.99** (list 79.99)
- SKU 756291 — Farbe Blau, Groesse 43, **69.99**

The prices differ deliberately: it is the only product here whose SKUs disagree, so it is what
tells a product-level "from" price apart from a flat one.

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
