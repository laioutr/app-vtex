# Plan: `@laioutr-app/vtex` — Nuxt 3 / Laioutr Orchestr Wrapper für die VTEX API

## Context

Das Repo `app-vtex` wurde aus `app-starter` erzeugt und enthält aktuell nur Placeholder (`my-laioutr-app`). Ziel ist ein produktiver Laioutr Orchestr Wrapper für die VTEX Commerce Platform, analog zu `app-commercetools` (lokales Referenz-Repo) und `app-shopware`. Fokus: Storefront-relevante Endpunkte, primär **GET**; **Cart** (Shopping Cart), **Wishlist** und **Reviews/Ratings** zusätzlich mit Create/Update/Delete.

Die größte Einzelaufgabe ist die **Authentifizierung** — VTEX hat drei überlagerte Auth-Dimensionen, die sauber getrennt werden müssen:

1. **App-Level / Server-to-Server** (AppKey/AppToken) — für geschützte Backend-/Admin-Calls (Catalog Admin-Reads, Pricing, Headless CMS).
2. **Customer: eingeloggt** — `VtexIdclientAutCookie_<accountName>` via VTEX ID Login.
3. **Customer: nicht eingeloggt (anonymous)** — Session-Cookies (`vtex_session`, `vtex_segment`, `checkout.vtex.com`) + OrderForm-Ownership.

---

## 1. Repo-Status (Ist-Stand)

Aus `app-starter` bereits vorhanden:
- `src/module.ts` — leere `ModuleOptions`, `registerLaioutrApp({ orchestrDirs })`, `installModule` für `@nuxt/image`, `@laioutr-core/frontend-core`, `@laioutr-core/orchestr`, `@laioutr-app/ui`
- `src/runtime/app/blocks/` + `src/runtime/app/sections/` (leer, `.gitkeep`)
- `src/runtime/server/orchestr/plugins/zodFix.ts` (Nitro Plugin)
- `build.config.ts`, `playground/`, `test/`, `globalExtensions.ts`, `tsconfig.json`, `README.md`

Placeholder `my-laioutr-app` → `@laioutr-app/vtex` in: `package.json`, `globalExtensions.ts` (2x), `src/module.ts` (2x), `playground/package.json`, `README.md` (9x).

---

## 2. `ModuleOptions`

```ts
export interface ModuleOptions {
  // Account / Umgebung
  accountName: string;               // VTEX Account Subdomain
  environment: 'vtexcommercestable' | 'myvtex'; // default 'vtexcommercestable'

  // Server-to-Server Auth
  appKey: string;                    // X-VTEX-API-AppKey
  appToken: string;                  // X-VTEX-API-AppToken

  // Storefront-Defaults
  salesChannel?: string;             // default '1'
  locale?: string;                   // default 'de-DE'
  currencyCode?: string;             // default 'EUR'
}
```

`runtimeConfig.vtex` via `defu(options)`. Base URL:
`https://${accountName}.${environment}.com.br` (bzw. `…myvtex.com`).

---

## 3. Authentifizierungs-Architektur

**Client-Factory** (`runtime/server/client/vtexClientFactory.ts`) liefert pro Request einen Fetch-Wrapper mit Cookie-Awareness.

### 3.1 App-Level (S2S)
- Statische Header `X-VTEX-API-AppKey` / `X-VTEX-API-AppToken` aus `runtimeConfig.vtex`.
- Langlebige Tokens, kein Refresh.
- Nötig für: Catalog Admin-Reads (Seller, Supplier, Indexing, etc.), Pricing, Headless CMS, Gift Card Mgmt.

### 3.2 Anonymous Storefront Session
- Cookies Browser ↔ VTEX ↔ Wrapper: `vtex_session`, `vtex_segment`, `checkout.vtex.com`.
- Middleware liest eingehende Cookies, leitet sie via `Cookie`-Header an VTEX weiter.
- `Set-Cookie`-Responses werden via `setCookie(event, …)` an den Client zurückgereicht (httpOnly, secure, sameSite=lax, path=/).
- Erste Session: `POST /api/sessions` initialisiert anonyme Session.
- OrderForm: `POST /api/checkout/pub/orderForm` idempotent — liefert bestehenden Cart (via `checkout.vtex.com`) oder neuen.

### 3.3 Customer Login (VTEX ID)
Dedizierte Actions:
1. `auth.start` → `GET /api/vtexid/pub/authentication/start`
2. `auth.validateClassic` → `POST /api/vtexid/pub/authentication/classic/validate` (Email + Passwort)
3. `auth.logout` → `GET /api/vtexid/pub/logout`

VTEX setzt `VtexIdclientAutCookie_<accountName>` — Passthrough im Wrapper. Status-Check: Cookie im eingehenden Request → logged-in.

### 3.4 Request-Client (zwei Fetcher)
- `publicFetch(path, init)` — leitet Session-/Customer-Cookies weiter, **ohne** AppKey/Token. Für: Storefront-Catalog, Search, Checkout-`/pub/*`, VTEX ID, Reviews-Read.
- `adminFetch(path, init)` — fügt `X-VTEX-API-AppKey`/`Token` hinzu. Für: Catalog Admin-Reads, Pricing, Headless CMS, Gift Card.
- Beide setzen `Content-Type: application/json`, `Accept: application/json` und propagieren `Set-Cookie`.

### 3.5 Orchestr-Integration
```ts
// runtime/server/middleware/defineVtex.ts
export const defineVtex = defineOrchestr
  .meta({ app: name })
  .extendRequest(async ({ event, clientEnv }) => {
    const vtexClient = await vtexClientFactory({ event, clientEnv });
    return {
      context: {
        vtexClient,
        accountName: runtimeConfig.vtex.accountName,
        salesChannel: runtimeConfig.vtex.salesChannel,
        isAuthenticated: vtexClient.isAuthenticated,
      },
    };
  });

export const defineVtexQuery             = defineVtex.queryHandler;
export const defineVtexAction            = defineVtex.actionHandler;
export const defineVtexLink              = defineVtex.linkHandler;
export const defineVtexComponentResolver = defineVtex.componentResolver;
```

---

## 4. Ordner-Struktur (Ziel)

```
src/runtime/server/
├── client/
│   ├── index.ts
│   ├── vtexClientFactory.ts           # public/admin fetcher, cookie passthrough
│   ├── cookies.ts                     # VTEX Cookie Namen + Helpers
│   └── types.ts
├── middleware/
│   └── defineVtex.ts
└── orchestr/
    ├── plugins/zodFix.ts              # vorhanden
    ├── auth/                          # VTEX ID flows
    ├── session-manager/               # sessions + segment
    ├── catalog/                       # category, brand, product, sku, seller, …
    ├── checkout/                      # shopping cart (CRUD)
    ├── giftcard/
    ├── headless-cms/                  # pages
    ├── intelligent-search/            # autocomplete, PLP
    ├── pricing/
    ├── wishlist/                      # CRUD via MasterData
    └── reviews/                       # rating + review (CRUD)
```

---

## 5. Endpoint-Katalog (finaler User-Scope)

**Legende:** `[A]` = Customer-Auth (VtexIdclientAutCookie), `[S]` = AppKey/AppToken, kein Marker = public/anonym.
**Ops:** `R` = Read/GET-Queries, `RW` = Read + Create/Update/Delete.

### 5.1 Session Manager API — **R**
- **Sessions** — `GET/POST /api/sessions` (current session, init)
- **Segment** — `GET /api/segments` / `/api/segments/{segmentId}`

### 5.2 Catalog API — **R** (Storefront + Admin-Reads, `[S]` wo nicht `/pub/*`)
Pro Resource jeweils List + ByID-Queries:
- **Category** — `GET /api/catalog_system/pub/category/tree/{n}` (public) + `GET /api/catalog/pvt/category/{id}` [S]
- **Category Specification** — `GET /api/catalog/pvt/category/{categoryId}/specification` [S]
- **Brand** — `GET /api/catalog_system/pub/brand/list` (public) + `GET /api/catalog/pvt/brand/{id}` [S]
- **Specification Group** — `GET /api/catalog/pvt/specificationgroup/{id}` [S]
- **Specification** — `GET /api/catalog/pvt/specification/{id}` [S]
- **Specification Value** — `GET /api/catalog/pvt/specificationvalue/{id}` [S]
- **Product** — `GET /api/catalog_system/pub/products/search/{slug}/p` (public) + `GET /api/catalog/pvt/product/{id}` [S]
- **Product Specification** — `GET /api/catalog/pvt/product/{productId}/specification` [S]
- **SKU** — `GET /api/catalog_system/pvt/sku/stockkeepingunitbyid/{skuId}` [S]
- **SKU Specification** — `GET /api/catalog/pvt/stockkeepingunit/{skuId}/specification` [S]
- **SKU File** — `GET /api/catalog/pvt/stockkeepingunit/{skuId}/file` [S]
- **SKU Complement** — `GET /api/catalog/pvt/stockkeepingunit/{skuId}/complement` [S]
- **SKU EAN** — `GET /api/catalog/pvt/stockkeepingunit/{skuId}/ean` [S]
- **Attachment** — `GET /api/catalog/pvt/attachment/{id}` [S]
- **SKU Attachment** — `GET /api/catalog/pvt/stockkeepingunit/{skuId}/attachment` [S]
- **SKU Service** — `GET /api/catalog/pvt/stockkeepingunit/{skuId}/service` [S]
- **SKU Kit** — `GET /api/catalog/pvt/stockkeepingunit/{skuId}/kit` [S]
- **SKU Seller** — `GET /api/catalog/pvt/stockkeepingunit/{skuId}/seller` [S]
- **SKU Attribute** — `GET /api/catalog/pvt/stockkeepingunit/{skuId}/attribute` [S]
- **Multi-language (beta)** — Translation-Read-Endpoints [S]
- **Similar Category** — `GET /api/catalog/pvt/category/{id}/similarcategory` [S]
- **Collection** — `GET /api/catalog/pvt/collection/{id}` [S]
- **Subcollection** — `GET /api/catalog/pvt/subcollection/{id}` [S]
- **Seller** — `GET /api/seller-register/pvt/sellers/{id}` [S]
- **Supplier** — `GET /api/catalog/pvt/supplier/{id}` [S]
- **Sales Channel** — `GET /api/catalog_system/pub/saleschannel/list` (public) + `/pvt/...` [S]
- **Product Indexing** — `GET /api/catalog_system/pvt/products/GetProductAndSkuIds` [S]

### 5.3 Checkout API → **Shopping Cart** — **RW**
- `cart.getCurrent` (Q) — `POST /api/checkout/pub/orderForm`
- `cart.addItems` (A) — `POST /api/checkout/pub/orderForm/{orderFormId}/items`
- `cart.updateItems` (A) — `POST /api/checkout/pub/orderForm/{orderFormId}/items/update`
- `cart.removeItem` (A) — `POST .../items/update` mit `quantity: 0`
- `cart.clear` (A) — `POST /api/checkout/pub/orderForm/{orderFormId}/items/removeAll`
- `cart.applyCoupon` (A) — `POST /api/checkout/pub/orderForm/{orderFormId}/coupons`
- `cart.removeCoupon` (A) — `POST .../coupons` leerer Body
- `cart.setShippingAddress` (A) — `POST .../attachments/shippingData`
- `cart.setClientProfile` (A) — `POST .../attachments/clientProfileData`
- `cart.setMarketingData` (A) — `POST .../attachments/marketingData`
- `cart.simulateShipping` (Q) — `POST /api/checkout/pub/orderforms/simulation`

### 5.4 Gift Card API → **Gift Cards** — **R** [S]
- `giftcard.list` (Q) — `GET /api/giftcardsystem/private/giftCards`
- `giftcard.byId` (Q) — `GET /api/giftcardsystem/private/giftCards/{giftCardId}`
- `giftcard.balanceByCode` (Q) — `GET /api/giftcardsystem/pub/giftCards/redemptioncode/{code}`

### 5.5 Headless CMS API → **Pages** — **R** [S]
- `cms.pages.list` (Q) — `GET /api/headless-cms/pages`
- `cms.pages.byId` (Q) — `GET /api/headless-cms/pages/{pageId}`
- `cms.pages.bySlug` (Q) — `GET /api/headless-cms/pages?slug={slug}`

### 5.6 Intelligent Search API — **R**
- **Autocomplete**
  - `search.autocomplete.suggestions` (Q) — `GET /api/io/_v/api/intelligent-search/search_suggestions`
  - `search.autocomplete.topSearches` (Q) — `GET /api/io/_v/api/intelligent-search/top_searches`
  - `search.autocomplete.correction` (Q) — `GET /api/io/_v/api/intelligent-search/correction_search`
- **Product List Page (PLP)**
  - `search.products` (Q) — `GET /api/io/_v/api/intelligent-search/product_search/{query}`
  - `search.facets` (Q) — `GET /api/io/_v/api/intelligent-search/facets/{query}`
  - `search.productsByIds` (Q) — `GET /api/io/_v/api/intelligent-search/product_search?productId=…`

### 5.7 Pricing API — **R** [S]
- **Prices & Fixed Prices**
  - `pricing.byItemId` (Q) — `GET /pricing/prices/{itemId}`
  - `pricing.fixed.byItemId` (Q) — `GET /pricing/prices/{itemId}/fixed`
  - `pricing.fixed.list` (Q) — `GET /pricing/prices/{itemId}/fixed/{priceTableId}`
- **Pricing Configuration**
  - `pricing.config.get` (Q) — `GET /pricing/pipeline/catalog`
  - `pricing.config.computedPrice` (Q) — `GET /pricing/pipeline/computed-prices`
- **Price Tables**
  - `pricing.priceTables.list` (Q) — `GET /pricing/priceTables`
  - `pricing.priceTables.byId` (Q) — `GET /pricing/priceTables/{priceTableId}`

### 5.8 Wishlist API — **RW** [A]
VTEX hat eine native Wishlist-App (`vtex.wishlist`), die unter der Haube MasterData-Entity `wishlist` nutzt. Operationen laufen gegen den Wishlist-GraphQL-Service bzw. direkt gegen MasterData:
- `wishlist.get` (Q) — `GET /api/dataentities/wishlist/search?_where=shopperId={email}&_fields=id,productId,title`
- `wishlist.checkProduct` (Q) — `GET .../search?_where=shopperId={email} AND productId={productId}`
- `wishlist.addItem` (A) — `POST /api/dataentities/wishlist/documents` [A oder S]
- `wishlist.updateItem` (A) — `PATCH /api/dataentities/wishlist/documents/{id}` [A oder S]
- `wishlist.removeItem` (A) — `DELETE /api/dataentities/wishlist/documents/{id}` [A oder S]

Hinweis: `shopperId` = Email aus `VtexIdclientAutCookie`. MasterData benötigt entweder eine passende ACL für den Customer-Token oder Fallback auf `adminFetch` mit AppKey/Token.

### 5.9 Reviews and Ratings API — **RW**
- **Rating**
  - `reviews.rating.byProductId` (Q) — `GET /reviews-and-ratings/api/rating/{productId}`
  - `reviews.rating.totalsList` (Q) — `GET /reviews-and-ratings/api/rating` (Listing mit Filter)
- **Review**
  - `reviews.list` (Q) — `GET /reviews-and-ratings/api/reviews?product_id={id}`
  - `reviews.byId` (Q) — `GET /reviews-and-ratings/api/reviews/{id}`
  - `reviews.create` (A) — `POST /reviews-and-ratings/api/reviews` [A]
  - `reviews.update` (A) — `PATCH /reviews-and-ratings/api/reviews/{id}` [A]
  - `reviews.delete` (A) — `DELETE /reviews-and-ratings/api/reviews/{id}` [A] (nur eigenes Review)

### 5.10 Auth / VTEX ID (querverbunden, siehe Abschnitt 3.3)
- `session.init` (A) — `POST /api/sessions`
- `auth.start`, `auth.validateClassic`, `auth.logout`, `auth.status`

---

## 5a. Product-Komposition (⚠ CTO-Review)

VTEX modelliert ein Produkt hierarchisch. Ein `Product` ist die Master-Entity, enthält 1..n `SKU`s (Varianten), und SKUs haben diverse Sub-Ressourcen:

```
Product
├── Product Specification (product-level specs)
├── Category (+ Category Specification, Similar Category)
├── Brand
├── Collection / Subcollection
└── SKU[]
    ├── SKU Specification (variant-level specs)
    ├── SKU File (Images, Media)
    ├── SKU EAN (Barcode)
    ├── SKU Complement
    ├── SKU Attachment (Attachment → customization fields)
    ├── SKU Service
    ├── SKU Kit (Bundle-Parts)
    ├── SKU Seller (Marketplace-Seller pro SKU)
    └── SKU Attribute
```

### Zwei Abrufpfade

**(A) Storefront hydriert — 1 Call, schnell:**
- `GET /api/catalog_system/pub/products/search/{slug}/p` liefert Product + alle SKUs + Basis-Specs + Images in einer Response. Für 90 % der Storefront-Use-Cases (PDP, Cards) ausreichend.
- Nachteil: **Keine** Complements, Attachments, Services, Kits, Files auf Detailebene, keine Admin-Specs.

**(B) Admin-Detailpfad — viele Calls `[S]`, vollständig:**
- Product: `GET /api/catalog/pvt/product/{id}`
- Product-Specs: `GET /api/catalog/pvt/product/{id}/specification`
- SKUs des Produkts: `GET /api/catalog_system/pvt/sku/stockkeepingunitByProductId/{productId}`
- Pro SKU parallel: Specs, Files, EAN, Complement, Attachment, Service, Kit, Seller, Attribute (9 Endpunkte).
- Ergibt bei `n` SKUs: `3 + 9·n` Requests → MUSS parallelisiert und gecacht werden.

### Vorschlag: Composition-Layer

Ein **Composition-Helper** (`runtime/server/composition/product.ts`) orchestriert beide Pfade. Zwei Varianten exponieren:

- `getProductStorefront(slug)` — nur Call (A). Für Listen, Cards, Basis-PDP.
- `getProductDetailed(id, { include: ['complement', 'attachment', 'kit', ...] })` — (A) + selektive (B)-Calls via `Promise.all`. Client kontrolliert via `include`, welche Sub-Ressourcen tatsächlich geholt werden → vermeidet unnötige Requests.

Der **Product Resolver** (`orchestr/catalog/product/base.resolver.ts`) mappt das Ergebnis auf Laioutr Canonical `Product` + `ProductVariant`. Entscheidung für den CTO:

1. **Welche Sub-Ressourcen gehören in den Default-Resolver?** (Base, Description, Price, Images → vermutlich aus (A). Specs/Attachments → optional via Provides-Liste?)
2. **SKU-Level Canonical-Mapping:** Ein Laioutr `ProductVariant` pro SKU, oder SKU-Details als verschachtelte Struktur im `Product`?
3. **Parallelisierungs-Strategie:** `Promise.all` naiv, oder mit Concurrency-Limit (z. B. `p-limit`) bei Katalogen mit vielen SKUs?
4. **Caching:** Product-Level Nitro-Cache (TTL) vor der Composition, um wiederholte PDP-Hits nicht N·Requests erzeugen zu lassen?

Implementierungs-Referenz: `app-commercetools/src/runtime/server/orchestr/product/base.resolver.ts` nutzt eine ähnliche `ProductProjection`+ Variants-Struktur in **einem** Commercetools-Call — hier ist VTEX strukturell fragmentierter und braucht einen expliziten Composition-Step.

---

## 5b. Category-Komposition (⚠ CTO-Review)

VTEX Categories sind baumstrukturiert. Eine Category-Seite (PLP) im Storefront braucht typischerweise mehrere Quellen:

```
Category
├── Tree-Position (Parent-Chain → Breadcrumb, Children → Sub-Nav)
├── Category Specification (→ Filter-Facets, produkt-klassifizierend)
├── Similar Category (→ Cross-Navigation)
└── Products in Category (kommt NICHT aus Catalog-API, sondern aus Intelligent Search)
```

### Endpoint-Mix

**Public / anonym:**
- `GET /api/catalog_system/pub/category/tree/{depth}` — kompletter Tree (cache-freundlich, einmal pro Session).
- `GET /api/io/_v/api/intelligent-search/product_search?query=…&selectedFacets=category-1/…` — Produkte einer Kategorie.
- `GET /api/io/_v/api/intelligent-search/facets/…` — Facetten für PLP-Filter.

**Admin / `[S]`:**
- `GET /api/catalog/pvt/category/{id}` — vollständige Metadaten (SEO-Titel, Meta-Description, Keywords, linkId, isActive).
- `GET /api/catalog/pvt/category/{categoryId}/specification` — Category-Specs.
- `GET /api/catalog/pvt/category/{id}/similarcategory` — verwandte Kategorien.

### Zwei Abrufpfade

**(A) Storefront-Nav — 1 Call:**
- `GET .../category/tree/{depth}` liefert den ganzen Baum mit Namen, URL-Slugs und Children. Reicht für Header-Navi, Breadcrumb-Resolution, Sitemap.
- **Kein** SEO-Text, keine Specs, keine Similar-Cats.

**(B) Category-Landingpage (PLP) — hydrierter Aufruf:**
- (A) Tree zur Breadcrumb-Herleitung (oder cached) +
- `[S]` `pvt/category/{id}` für SEO-Metadaten +
- `[S]` `pvt/category/{id}/specification` (optional — wenn eigene Filter statt Intelligent-Search-Facets gewünscht) +
- `[S]` `pvt/category/{id}/similarcategory` (optional) +
- Public `intelligent-search/product_search` + `facets` für Produkt-Grid.

### Vorschlag: Composition-Layer

`runtime/server/composition/category.ts`:

- `getCategoryTree()` — nur (A), cached (Nitro). Shared von Navi, Breadcrumb, Sitemap.
- `getCategoryLanding(id, { include: ['specifications', 'similar'], products: { page, filters } })` — orchestriert (B) parallel via `Promise.all`; Products separat über Intelligent-Search-Query.

Category-Resolver (`orchestr/catalog/category/base.resolver.ts`) mappt auf Laioutr Canonical `Category`:

- **Base** (id, name, slug, parentId) → aus Tree.
- **SEO** (title, meta) → aus `pvt/category/{id}`.
- **Children/Parent** → Tree-Traversal (lokal, kein Call).
- **Facets** → entweder Category-Specs (Admin) **oder** Intelligent-Search-Facets (public, dynamisch). CTO muss entscheiden.

### CTO-Entscheidungen

1. **Tree-Caching:** Nitro-Cache mit TTL (z. B. 10 min) vs. Request-scoped? Der Tree ändert sich selten — langer Cache sinnvoll, aber Invalidierung bei Admin-Änderung?
2. **Facet-Quelle:** Category Specification (`[S]`, statisch, konsistent) **oder** Intelligent Search Facets (public, dynamisch basierend auf verfügbarem Bestand)? → Üblicherweise Intelligent Search, weil es leere Facet-Values filtert. Dann entfällt der Category-Spec-Call für PLPs.
3. **Breadcrumb-Resolution:** Aus Tree traversieren (eine Fetch-Round) oder pro Category einzeln via `pvt/category/{id}` (N Fetches)? → Tree gewinnt klar.
4. **Slug → ID Resolution:** VTEX arbeitet intern mit Category-IDs, Frontend mit Slugs. Mapping im Tree-Traversal oder separater Lookup-Call?
5. **SEO-Fallback:** Wenn `pvt/category/{id}` kein Meta liefert (häufig bei frisch angelegten Kategorien), fallback auf Tree-Name + statisches Template?

---

## 6. Umsetzungs-Reihenfolge

1. **Rename** `my-laioutr-app` → `@laioutr-app/vtex` (Package, RuntimeConfig, README, Playground).
2. **ModuleOptions** + RuntimeConfig in `src/module.ts` + `globalExtensions.ts`.
3. **Client-Schicht**: `cookies.ts`, `vtexClientFactory.ts` (`publicFetch` + `adminFetch` + Cookie-Passthrough), `types.ts`.
4. **Orchestr-Middleware** `defineVtex.ts`.
5. **Auth + Session Manager** — `auth/*`, `session-manager/*`.
6. **Intelligent Search** (public, low-risk) — `autocomplete/*`, `product-list-page/*`.
7. **Catalog** (großer Block; public Storefront first, dann `/pvt/*` Admin-Reads).
8. **Checkout / Shopping Cart** — hier ist Cookie-Management kritisch.
9. **Pricing, Gift Card, Headless CMS** (`[S]`-only, rein Admin-Reads).
10. **Wishlist** (MasterData CRUD, erfordert Customer-Auth bzw. AppKey-Fallback).
11. **Reviews and Ratings** (mischt Customer-Auth und Public).
12. **Resolver** für `Product`, `Category`, `Cart`, `Order`, `Page` (Canonical-Types binding, analog `app-commercetools/src/runtime/server/orchestr/product/base.resolver.ts`).
13. **`PLAN.md`** ins Ziel-Repo committen für CTO-Review (bewährtes Vorgehen aus Sylius/B2B-Session).

---

## 7. Verification

- `pnpm i && pnpm dev:prepare` → Modul baut sauber.
- `pnpm orchestr-dev` → Orchestr Devtools zeigt alle Handler.
- Playground-Smoke-Tests:
  - **Anonym**: `cart.getCurrent` → frischer OrderForm, `checkout.vtex.com` Cookie gesetzt.
  - **Anonym**: `search.products` & `catalog.productBySlug` liefern Daten ohne Auth.
  - **Login**: `auth.validateClassic` → `VtexIdclientAutCookie_<account>` sichtbar.
  - **Post-Login**: `cart.getCurrent` → gleicher OrderForm, jetzt Customer-gebunden.
  - **Admin-Read**: `catalog.seller.byId` → 200 mit AppKey/Token (`adminFetch`).
  - **Mutation**: `reviews.create` nach Login → Review via `reviews.list` sichtbar.
  - **Wishlist**: `wishlist.addItem` nach Login → Eintrag via `wishlist.get` sichtbar, `wishlist.removeItem` entfernt ihn.
- **Unit-Tests (Vitest)** für `vtexClientFactory`: Cookie-Passthrough, Header-Injection, public vs admin Routing (mocked fetch).

---

## 8. Kritische Dateien (zu erstellen/modifizieren)

- `package.json` — name, repository, peerDeps aus `SYLIUS_CONTEXT.md` Vorlage.
- `src/module.ts` — ModuleOptions, runtimeConfig wiring.
- `src/globalExtensions.ts` — RuntimeConfig Typing (`vtex` statt `my-laioutr-app`).
- **Neu**: `src/runtime/server/client/{index,vtexClientFactory,cookies,types}.ts`.
- **Neu**: `src/runtime/server/middleware/defineVtex.ts`.
- **Neu**: `src/runtime/server/orchestr/{auth,session-manager,catalog,checkout,giftcard,headless-cms,intelligent-search,pricing,wishlist,reviews}/**/*.ts`.
- `playground/nuxt.config.ts` — ModuleOptions per `vtex: { … }` konfigurieren.
- `README.md` — VTEX-spezifisch ersetzen.

---

## 9. Offene Punkte (vor Implementierung klären)

**Entschieden:**
- **Customer-Login-Provider:** Nur Email/Password (classic). Kein Access-Key, kein OAuth. → Scope von `auth.sendAccessKey` und `auth.validateAccessKey` entfällt (siehe 5.10).
- **Reviews Delete:** Customer-Operation `[A]` (eigene Reviews löschen), keine Moderations-Variante via `[S]`.

**Offen:**
1. **Session-Init:** Automatisch in `defineVtex.extendRequest` (implizit, jeder Request checkt+erstellt) oder explizit als `session.init` Action vom Frontend?
2. **Multi-Language/Binding:** `locale`/`salesChannel` fix aus `ModuleOptions` oder dynamisch pro Request (z.B. aus `clientEnv.locale`)?
3. **Wishlist-Auth:** MasterData ACL so konfigurieren, dass der Customer-Token direkt schreiben darf, oder grundsätzlich `adminFetch` (AppKey/Token) mit `shopperId` aus `VtexIdclientAutCookie`?
4. **Catalog Pagination-Strategie:** VTEX `_from/_to` Header-Paging oder eigene Input-Normalisierung?
