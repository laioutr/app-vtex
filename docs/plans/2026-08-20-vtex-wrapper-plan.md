# Plan: `@laioutr/app-vtex` — Laioutr Orchestr Wrapper für die VTEX Commerce Platform

## Kontext

`app-vtex` ist ein Laioutr App (Nuxt-Modul), das VTEX als Commerce-Backend an eine Laioutr
Storefront anbindet. Referenz-Implementierung ist `app-shopware` (`@laioutr/app-shopware`), das
denselben Core-Stand fährt.

Stand der Core-Pakete zum Zeitpunkt dieses Plans:
`@laioutr-core/orchestr`, `kit`, `frontend-core`, `core-types` **0.42.0** · `canonical-types` **0.29.0**

**Leitprinzip:** Ein Orchestr-App wird nicht entlang der Backend-API strukturiert, sondern entlang
des kanonischen Entity-Modells. Jeder Handler bindet an ein **Token** aus
`@laioutr-core/canonical-types`. Alles, wofür es kein Token gibt, ist entweder ein interner
Client-Baustein oder nicht Teil des Scopes. `app-shopware` deckt eine vollständige Storefront mit
35 Handler-Dateien ab — die Zahl der VTEX-Endpunkte sagt nichts über die Zahl der Handler aus.

---

## 1. Repo-Status

Aus `app-starter` übernommen und bereits auf `@laioutr/app-vtex` umbenannt:
`src/module.ts` (leere `ModuleOptions`, `registerLaioutrApp`), `src/runtime/app/{blocks,sections}/`
(leer), `src/runtime/server/orchestr/plugins/zodFix.ts`, `build.config.ts`, `playground/`, `test/`.

Offen in `package.json`: `@laioutr-core/kit` und `@laioutr-core/orchestr` fehlen in den
`peerDependencies`, obwohl `src/module.ts` `kit` importiert. `app-shopware` pinnt beide.
Plattform-Pakete gehören laut `CLAUDE.md` in `peerDependencies`, damit das Host-Projekt genau eine
Kopie liefert.

---

## 2. `ModuleOptions` und RuntimeConfig

```ts
export interface ModuleOptions {
  accountName: string;
  environment: 'vtexcommercestable' | 'myvtex';  // default 'vtexcommercestable'
  appKey: string;                                 // X-VTEX-API-AppKey
  appToken: string;                               // X-VTEX-API-AppToken
  salesChannel?: string;                          // default '1'
}
```

**Es gibt nicht eine Base-URL.** Gegen das Partner-Konto verifiziert:

| Host | APIs |
|---|---|
| `https://{accountName}.{environment}.com.br` | Catalog, Catalog System, Checkout, Logistics, VTEX ID, Portal/Pagetype, Reviews |
| `https://api.vtex.com/{accountName}` | **Pricing** |

Der Pricing-Call gegen die Account-Domain schlägt fehl, der Logistics-Call gegen
`logistics.vtexcommercestable.com.br` liefert 401 — nur über die Account-Domain 200. Der Client
löst den Host deshalb **pro API** auf, statt einen `baseUrl` zu verketten.

**RuntimeConfig-Key ist der volle Paketname**, nicht `vtex`. `src/module.ts` setzt
`configKey: name` aus der `package.json`, entsprechend lautet der Key
`runtimeConfig['@laioutr/app-vtex']` — so wie `app-shopware` es mit
`runtimeConfig['@laioutr/app-shopware']` hält. `src/globalExtensions.ts` typisiert bereits gegen
diesen Key.

`locale` und `currencyCode` gehören **nicht** in die `ModuleOptions`: beide kommen pro Request aus
`clientEnv` bzw. der VTEX-Session. Ein fixer Wert im Modul-Config würde Multi-Market-Projekte
brechen.

---

## 3. Authentifizierung

VTEX hat drei überlagerte Auth-Dimensionen, die getrennt bleiben müssen.

### 3.1 App-Level (Server-to-Server)
Statische Header `X-VTEX-API-AppKey` / `X-VTEX-API-AppToken` aus der RuntimeConfig. Langlebig, kein
Refresh. Nötig für Catalog-Admin-Reads, Pricing und MasterData-Zugriffe ohne Customer-ACL.

### 3.2 Anonyme Storefront-Session
Cookies `vtex_session`, `vtex_segment`, `checkout.vtex.com` werden zwischen Browser und VTEX
durchgereicht: eingehende Cookies gehen als `Cookie`-Header an VTEX, `Set-Cookie` aus VTEX wird per
`setCookie(event, …)` an den Client zurückgegeben (httpOnly, secure, sameSite=lax, path=/).

### 3.3 Customer-Login (VTEX ID)
Email/Passwort (classic). VTEX setzt `VtexIdclientAutCookie_{accountName}`, das der Wrapper
durchreicht. Kein Access-Key, kein OAuth.

### 3.4 Zwei Fetcher
- `publicFetch(path, init)` — reicht Session- und Customer-Cookies durch, **ohne** AppKey/Token.
  Für Storefront-Catalog, Intelligent Search, Checkout `/pub/*`, VTEX ID, Reviews-Read.
- `adminFetch(path, init)` — setzt AppKey/AppToken. Für Catalog-Admin-Reads, Pricing, MasterData.

Beide propagieren `Set-Cookie` und beide nehmen die API-Kennung statt eines rohen Pfads
entgegen, damit die Host-Auflösung aus Abschnitt 2 an genau einer Stelle liegt.

---

## 4. Orchestr-Anbindung

```ts
// runtime/server/middleware/defineVtex.ts
export const defineVtex = defineOrchestr
  .meta({
    app: name,                            // aus package.json
    label: 'VTEX',
    logoUrl: '/app-vtex/vtex-logo.svg',   // Asset unter /app-<name>/ (CLAUDE.md)
  })
  .extendRequest(async (args) => {
    const client = await vtexClientFactory(args.event, args.clientEnv);
    return {
      context: {
        vtexClient: client,
        vtexAccountName: runtimeConfig.accountName,
        vtexSalesChannel: resolveSalesChannel(args.clientEnv),
        vtexIsAuthenticated: client.isAuthenticated,
      },
    };
  });

export const defineVtexQuery                 = defineVtex.queryHandler;
export const defineVtexAction                = defineVtex.actionHandler;
export const defineVtexLink                  = defineVtex.linkHandler;
export const defineVtexComponentResolver     = defineVtex.componentResolver;
export const defineVtexPageIndex             = defineVtex.pageIndex;
export const defineVtexQueryTemplateProvider = defineVtex.queryTemplateProvider;
```

Zwei Eigenschaften von `extendRequest` bestimmen das Design:

**Der Context ist global über alle Apps hinweg.** Die API-Doku sagt: *„The return value of the
callback will be merged into a global context, shared by all apps. Therefore you might want to
namespace your context keys."* Deshalb `vtexAccountName` statt `accountName` — generische Keys
kollidieren mit jeder anderen installierten App.

**`extendRequest` läuft bei jedem Request, auch bei fremden.** Die Doku: *„This handler will always
be executed for every query or action, regardless of whether the called action/request is actually
being handled by this orchestr instance."* Ein VTEX-`POST /api/sessions` an dieser Stelle würde also
bei **jedem** Storefront-Request feuern, auch bei solchen, die eine andere App bedient. Die
Session-Initialisierung muss deshalb **lazy** sein: `vtexClientFactory` baut nur den Client und liest
vorhandene Cookies; der Session-Call passiert erst beim ersten echten VTEX-Zugriff.

`use`-Middleware wird hier nicht gebraucht. Cookie-Writes aus Action-Handlern heraus sind zulässig —
die Einschränkung „keine Header/Cookies schreiben" gilt ausschließlich für `use`, weil `use` auch
während Query- und Resolver-Ausführung feuert.

---

## 5. Ordnerstruktur

Nach kanonischer Entity, nicht nach VTEX-API-Modul:

```
src/runtime/server/
├── client/
│   ├── vtexClientFactory.ts       # publicFetch + adminFetch, Cookie-Passthrough
│   ├── cookies.ts                 # VTEX-Cookie-Namen und Helpers
│   └── types.ts
├── vtex-helper/                   # interne Bausteine, KEINE Handler
│   ├── catalog/                   # Product/SKU-Komposition, Spec-Reads
│   ├── categoryTree.ts            # Tree laden, Slug→ID, Breadcrumb-Traversal
│   ├── search.ts                  # Intelligent Search + Facetten
│   ├── orderForm.ts               # OrderForm-Lifecycle
│   ├── masterdata.ts              # MasterData-Zugriff (CL, AD, wishlist)
│   ├── money.ts                   # VTEX-Preis → Money
│   └── mappers/
├── middleware/
│   └── defineVtex.ts
├── const/
│   └── passthroughTokens.ts
└── orchestr/
    ├── plugins/zodFix.ts
    ├── product/
    ├── product-variant/
    ├── category/
    ├── menu/
    ├── cart/
    ├── cart-item/
    ├── review/
    ├── product-list/              # Wishlist
    ├── customer/
    ├── order/
    ├── auth/
    └── suggested-search/
```

---

## 6. Kanonische Bindungen

Vollständige Liste dessen, was implementiert wird. Links steht das Token aus
`@laioutr-core/canonical-types/ecommerce` (bzw. `/core`), rechts der VTEX-Zugriff.

### 6.1 Product
| Token | Datei | VTEX |
|---|---|---|
| `ProductBySlugQuery` | `product/bySlug.query.ts` | `GET /api/catalog_system/pub/products/search/{slug}/p` — Slug ist `linkText`, siehe unten |
| `ProductsByCategoryIdQuery` | `product/byCategoryId.query.ts` | Intelligent Search `product_search` mit `selectedFacets=category-N` |
| `ProductsByCategorySlugQuery` | `product/byCategorySlug.query.ts` | dito, Slug→ID über den Category-Tree |
| `ProductSearchQuery` | `product/search.query.ts` | `GET /api/io/_v/api/intelligent-search/product_search/{query}` |
| `ProductVariantsLink` | `product/variants.link.ts` | SKUs aus der Product-Response |
| `ProductBreadcrumbLink` | `product/breadcrumb.link.ts` | Category-Tree-Traversal |
| `ProductAllCategoriesLink` | `product/all-categories.link.ts` | `categoriesIds` der Product-Response |
| `ProductReviewsLink` | `product/reviews.link.ts` | `GET /reviews-and-ratings/api/reviews?product_id={id}` |

Zwei am Live-Konto verifizierte Fallstricke:

- **Der Slug ist `linkText`, nicht `LinkId`.** Für dasselbe Produkt lautet `LinkId`
  `Slip-On-Sneaker`, der auflösbare Slug aber `slip-on-sneaker`. Die Suche ist an dieser Stelle
  case-sensitiv: die `LinkId`-Schreibweise liefert ein leeres Ergebnis, kein 404.
- **`fq=skuId:` filtert nicht.** `fq=productId:{id}` liefert das Produkt, `fq=skuId:{id}` liefert
  leer. Ein Aufruf ganz ohne `fq` liefert ebenfalls leer — die Suche braucht ein Filter- oder
  Kategorie-Kriterium und taugt nicht als Katalog-Dump. Für Vollständigkeit ist
  `GetProductAndSkuIds` `[adminFetch]` der richtige Weg, und genau den nutzt der Page-Index.

Resolver `product/base.resolver.ts` liefert: `ProductBase`, `ProductInfo`, `ProductDescription`,
`ProductMedia`, `ProductPrices`, `ProductSeo`, `ProductFlags`, `ProductRating`,
`ProductDefaultVariant`, `ProductBrand`, `ProductSpecifications`, `ProductOptionGroups`.

`ProductBrand` und `ProductSpecifications` sind der kanonische Platz für VTEX-Brand- und
Specification-Daten — die gehören nicht in eigene Queries.

### 6.2 ProductVariant (SKU)
`product-variant/base.resolver.ts` liefert `ProductVariantBase`, `ProductVariantInfo`,
`ProductVariantPrices`, `ProductVariantOptions`, `ProductVariantAvailability`.
Optional je nach VTEX-Daten: `ProductVariantEnergyLabel`, `ProductVariantShipping`,
`ProductVariantQuantityPrices`, `ProductVariantQuantityRule`.

### 6.3 Category / Menu
| Token | Datei | VTEX |
|---|---|---|
| `CategoryAllQuery` | `category/all.query.ts` | `GET /api/catalog_system/pub/category/tree/{depth}` |
| `CategoryBySlugQuery` | `category/bySlug.query.ts` | Tree-Traversal (lokal, kein zusätzlicher Call) |
| `ChildCategoriesLink` | `category/child-categories.link.ts` | Tree |
| `CategoryBreadcrumbLink` | `category/breadcrumb.link.ts` | Tree |
| `CategoryProductsLink` | `category/products.link.ts` | Intelligent Search |
| `MenuByAliasQuery` | `menu/byAlias.query.ts` | Tree, auf Menu-Aliase gemappt |

Resolver `category/base.resolver.ts`: `CategoryBase`, `CategoryContent`, `CategorySeo`,
`CategoryMedia`. SEO-Felder kommen aus `GET /api/catalog/pvt/category/{id}` `[adminFetch]`, mit
Fallback auf den Tree-Namen.

Der Tree wird einmal geladen und via Nitro-Cache geteilt — Breadcrumb, Navigation, Slug-Auflösung
und Sitemap greifen alle darauf zu.

### 6.4 Cart
| Token | Datei | VTEX |
|---|---|---|
| `GetCurrentCartQuery` | `cart/get-current.query.ts` | `POST /api/checkout/pub/orderForm` (idempotent) |
| `CartAddItemsAction` | `cart/add-items.action.ts` | `POST .../orderForm/{id}/items` |
| `CartUpdateItemsAction` | `cart/update-items.action.ts` | `POST .../items/update` |
| `CartRemoveItemsAction` | `cart/remove-items.action.ts` | `POST .../items/update` mit `quantity: 0` |
| `GetCheckoutUrlAction` | `cart/get-checkout-url.action.ts` | VTEX-Checkout-URL inkl. OrderForm-Binding |
| `CartItemsLink` | `cart/cart-items.link.ts` | OrderForm-Items |
| `CartItemProductVariantLink` | `cart-item/product-variant.link.ts` | Item → SKU |

Resolver: `cart/base.resolver.ts` (`CartBase`, `CartCost`), `cart-item/base.resolver.ts`.

Die Action-Handler schreiben das `checkout.vtex.com`-Cookie direkt per `setCookie(event, …)`.

### 6.5 Auth / Customer / Order
| Token | VTEX |
|---|---|
| `AuthLoginAction` | `POST /api/vtexid/pub/authentication/classic/validate` |
| `AuthLogoutAction` | `GET /api/vtexid/pub/logout` |
| `AuthRegisterAction` | VTEX ID + MasterData `CL` |
| `AuthRecoverAction` | VTEX ID Password-Recovery |
| `CustomerGetCurrentAction` | MasterData `CL` über `VtexIdclientAutCookie` |
| `CustomerUpdateAction` | MasterData `CL` PATCH |
| `CustomerAddressCreateAction`, `CustomerAddressUpdateAction`, `CustomerAddressDeleteAction`, `CustomerAddressSetDefaultAction` | MasterData `AD` |
| `AddressGetAllAction` | MasterData `AD` Search |
| `OrderCancelAction`, `OrderReorderAction`, `OrderGetStatisticsAction` | OMS `/api/oms/user/orders` |

Auth und Customer fehlten im Vorgängerplan vollständig, obwohl ohne sie keine Kundenkonto-Strecke
existiert.

### 6.6 Review
| Token | VTEX |
|---|---|
| `CreateReviewAction` | `POST /reviews-and-ratings/api/reviews` |
| `ProductReviewsLink` | `GET /reviews-and-ratings/api/reviews?product_id={id}` |

Resolver `review/base.resolver.ts`: `ReviewBase`, `ReviewContent`, `ReviewReviewer`.
Rating-Aggregate (`GET /reviews-and-ratings/api/rating/{productId}`) fließen in `ProductRating`.

Für Update und Delete von Reviews gibt es **keine** kanonischen Tokens — entfällt.

### 6.7 ProductList (Wishlist)
Die Wishlist ist kanonisch als `product-list`-Entity modelliert; ein eigenes `wishlist.*`-API wäre
eine Parallelwelt. MasterData ist der Speicher, nicht die Schnittstelle.

| Token | VTEX |
|---|---|
| `ProductListGetWishlistQuery` | MasterData `wishlist`-Entity, `shopperId` = Email aus dem Auth-Cookie |
| `ProductListByIdQuery` | dito, per Document-ID |
| `ProductListAddItemsAction`, `ProductListRemoveItemsAction`, `ProductListUpdateItemsAction` | MasterData Documents |
| `ProductListCreateAction`, `ProductListUpdateAction`, `ProductListDeleteAction`, `ProductListDuplicateAction` | MasterData Documents |
| `ProductListAddToCartAction` | Wishlist-Items → OrderForm |
| `ProductListItemsLink`, `ProductListItemProductLink`, `ProductListItemProductVariantLink` | Item-Auflösung |

Resolver: `ProductListBase`, `ProductListVisibility`.

### 6.8 Suggested Search
| Token | VTEX |
|---|---|
| `SuggestedSearchSearchQuery` | `GET /api/io/_v/api/intelligent-search/search_suggestions` |
| `SuggestedSearchEntriesLink`, `SuggestedSearchProductsLink` | `top_searches`, `correction_search` |

---

## 7. Page-Indexes

Ohne Page-Index gibt es keine PDP- und keine PLP-URLs. Der Vorgängerplan hatte keinen einzigen.

| Page-Type | Datei | VTEX |
|---|---|---|
| `ProductDetailPage` | `product/detail-page.page-index.ts` | `list`/`count` über `GetProductAndSkuIds`, `locate` über die Slug-Suche |
| `ProductListingPage` | `category/listing-page.page-index.ts` | Category-Tree |
| `ProductSearchPage` | `product/search-page.page-index.ts` | Suchseite |

Jeder Index implementiert `locate`, `count`, `search`, `list` und setzt `cache: { ttl, search, locate }`.
Der Category-Tree ändert sich selten und verträgt eine lange TTL; Produkt-Locates brauchen eine
kürzere. `paginate` aus `#imports` deckt das Cursor-Handling für `list` ab.

---

## 8. Query-Templates

`*.template.ts` liefert Studio benannte Preset-Inputs, aus denen Redakteure auswählen. Sinnvoll für
`ProductsByCategorySlugQuery` (die wichtigsten Kategorien) und `MenuByAliasQuery` (die vorhandenen
Menu-Aliase). Registrierung über `defineVtexQueryTemplateProvider`.

---

## 9. Product-Komposition und N+1

VTEX modelliert Produkte fragmentiert. Zwei Abrufpfade:

**(A) Storefront, ein Call.** `products/search/{slug}/p` liefert Product, alle SKUs, Basis-Specs und
Bilder. Deckt PDP und Karten ab.

**(B) Admin-Detail, viele Calls `[adminFetch]`.** Product-Specs, SKU-Files, EAN, Complement,
Attachment, Service, Kit, Seller, Attribute. Bei `n` SKUs sind das `3 + 9·n` Requests.

Der Composition-Helper `vtex-helper/catalog/` bietet `getProductStorefront(slug)` (nur A) und
`getProductDetailed(id, { include })` (A plus selektive B-Calls über `Promise.all` mit
Concurrency-Limit). Der Default-Resolver fährt ausschließlich Pfad A; alles Weitere nur, wenn eine
angeforderte Komponente es erzwingt.

**`passthrough` ist der Hebel gegen N+1.** Ein Query-Handler legt bereits geladene Daten in ein
`PassthroughToken`, der Resolver liest sie und spart den Refetch —
`app-shopware` reicht so die aufgelöste Default-Variante von `bySlug.query.ts` an
`base.resolver.ts` durch. Für VTEX gehören mindestens die geladene Product-Response und die
SKU-Liste in `const/passthroughTokens.ts`.

---

## 10. Money

`CLAUDE.md` schreibt vor: `{ amount, currency }` mit `amount` in **Minor Units** und `currency` als
**ISO-4217-Code**. `app-shopware` nutzt dafür `@screeny05/ts-money`.

VTEX ist hier **nicht einheitlich**. Gegen die offiziellen OpenAPI-Schemas geprüft:

| API | Darstellung | Beleg |
|---|---|---|
| Checkout (OrderForm) | **Integer, Minor Units** | 29 von 30 Geldfeldern `type: integer`; am Live-Konto `value: 0` als Int, Währung `EUR` |
| Legacy Search (`catalog_system`) | **Dezimal** | am Live-Konto: `Price`, `ListPrice`, `PriceWithoutDiscount` je `49.99` als Float, `Tax` `0.0`, `AvailableQuantity` `100` als Int |
| Intelligent Search | **Dezimal** | `sellers[].commertialOffer.Price`/`ListPrice`/`spotPrice` sind `type: number` |
| Pricing (`api.vtex.com`) | **Dezimal** | am Live-Konto: `basePrice`/`costPrice` je `49.99` |

Die Doku bestätigt die Checkout-Seite wörtlich: *„Any properties representing monetary values will
have cents as their units. (e.g. `10390` means R$103,90 in Brazilian stores.)"*

Zwei Ausnahmen, die beim Mapping Fehler produzieren:

1. **`items[].priceTags[].rawValue` ist dezimal**, obwohl der Rest des OrderForms Minor Units nutzt.
   Das ist das einzige `type: number` im Checkout-Schema.
2. **`sellingPrice` ist nicht rundungssicher.** Die VTEX-Doku warnt vor Rundungsabweichungen und
   verweist auf `priceDefinition`. Der Cart-Resolver nutzt deshalb
   `priceDefinition.calculatedSellingPrice` und `priceDefinition.total`, nicht `sellingPrice`.

`vtex-helper/money.ts` kapselt beide Richtungen — `fromMinorUnits` für Checkout,
`fromDecimal` für die Suche — und **kein** Handler rechnet selbst. Die Währung stammt aus der
VTEX-Session bzw. dem Segment-Cookie, nicht aus einer Modul-Option.

Quellen: [orderForm fields](https://developers.vtex.com/docs/guides/orderform-fields) ·
[vtex/openapi-schemas](https://github.com/vtex/openapi-schemas) (`VTEX - Checkout API.json`,
`VTEX - Search API.json`, `VTEX - Intelligent Search API.json`)

---

## 11. Fehler-Mapping

Kanonische Fehler werden gezielt geworfen statt generischer `Error`s:
`ProductNotFoundError`, `ProductStockError`, `ProductQuantityError`, `CategoryNotFoundError`,
`UnauthenticatedError`, `InvalidCredentialsError`, `CustomerDisabledError`, `AddressNotFoundError`,
`InvalidFieldError`, `OrderNotFoundError`, `OrderNotCancellableError`, `ProductListNotFoundError`,
`ProductListItemNotFoundError`.

Jeder Fehlerpfad im Client wird auf einen dieser Typen abgebildet; nur dann können
Backend-agnostische Storefront-Komponenten darauf reagieren.

---

## 12. Nicht im Scope

Ohne kanonisches Token gibt es keine Bindung, und ein App-eigenes Token
(`defineQueryToken`) wäre für Storefront-Komponenten unbrauchbar, weil es die
Backend-Agnostik bricht. Nur `app-hygraph` nutzt diesen Weg, für genau einen Fall. Deshalb
entfallen:

- **Gift Cards** — keine kanonische Entity.
- **Headless CMS Pages** — keine kanonische Page-Entity; Content-Seiten entstehen in Studio.
- **Cart-Zusatzoperationen** — Coupons, `shippingData`, `clientProfileData`, `marketingData`,
  Shipping-Simulation. Kein kanonisches Token vorhanden.
- **Reviews Update/Delete** — nur `CreateReviewAction` existiert.
- **Catalog-Admin-Reads als eigene Handler** — Seller, Supplier, SpecificationGroup, SKU-EAN/Kit/
  Attachment/Service/Complement, Collection, Subcollection, Product-Indexing. Das sind interne
  Client-Bausteine unter `vtex-helper/catalog/`, die `ProductSpecifications`, `ProductBrand` und die
  Variant-Komponenten speisen.
- **Pricing-API als eigene Handler** — fließt in `ProductPrices`, `ProductVariantPrices`,
  `ProductVariantQuantityPrices`.
- **Session-Manager als eigene Handler** — Infrastruktur des Clients, keine Query.

---

## 13. Umsetzungsreihenfolge

1. `peerDependencies` um `@laioutr-core/kit` und `@laioutr-core/orchestr` ergänzen.
2. `ModuleOptions` und RuntimeConfig in `src/module.ts`.
3. Client-Schicht: `cookies.ts`, `vtexClientFactory.ts`, `types.ts`.
4. `defineVtex.ts` mit namespaced Context und lazy Session.
5. `money.ts` und die Mapper — vor allem, was Preise anfasst.
6. Category-Tree-Helper plus `category/`- und `menu/`-Handler (public, cache-freundlich).
7. Intelligent Search: `ProductSearchQuery`, `SuggestedSearch*`.
8. Product und ProductVariant: Queries, Links, Resolver, Composition-Helper, Passthrough-Tokens.
9. Page-Indexes für `ProductDetailPage`, `ProductListingPage`, `ProductSearchPage`.
10. Cart und CartItem — hier ist das Cookie-Handling kritisch.
11. Auth, Customer, Address.
12. Review plus `ProductRating`.
13. ProductList (Wishlist) auf MasterData.
14. Order.
15. Query-Templates.
16. Fehler-Mapping über alle Handler ziehen.

---

## 14. Verifikation

- `pnpm install && pnpm dev:prepare` baut das Modul.
- `pnpm lint`, `pnpm test:types`, `pnpm test` laufen sauber.
- Playground-Smoke-Tests:
  - **Anonym:** `GetCurrentCartQuery` liefert einen frischen OrderForm, `checkout.vtex.com` gesetzt.
  - **Anonym:** `ProductBySlugQuery` und `ProductSearchQuery` liefern ohne Auth.
  - **Login:** `AuthLoginAction` setzt `VtexIdclientAutCookie_{account}`.
  - **Nach Login:** `GetCurrentCartQuery` liefert denselben OrderForm, jetzt kundengebunden.
  - **Mutation:** `CreateReviewAction`, danach über `ProductReviewsLink` sichtbar.
  - **Wishlist:** `ProductListAddItemsAction` → über `ProductListGetWishlistQuery` sichtbar,
    `ProductListRemoveItemsAction` entfernt.
  - **Page-Index:** `list` und `locate` für `ProductDetailPage` liefern konsistente Slugs.
- Unit-Tests (Vitest) für `vtexClientFactory` (Cookie-Passthrough, Header-Injection, public vs.
  admin Routing gegen gemocktes `fetch`), `money.ts` und die Tree-Traversal-Helper. Keine
  Komponenten-Tests.

---

## 15. Offene Punkte

1. **MasterData-ACL** — darf der Customer-Token direkt in `wishlist`, `CL` und `AD` schreiben, oder
   braucht es durchgängig `adminFetch` mit `shopperId` aus dem Auth-Cookie?
2. **Facetten-Quelle** — Intelligent-Search-Facetten (dynamisch, filtert leere Werte) oder Category
   Specifications (statisch, `adminFetch`)? Tendenz: Intelligent Search, dann entfällt der
   Spec-Call für PLPs.
3. **Sales-Channel und Locale pro Request** — Ableitung aus `clientEnv` festlegen, inklusive
   Fallback, wenn ein Markt keinen Sales-Channel gemappt hat.
4. **Tree-Cache-Invalidierung** — TTL allein, oder ein Invalidierungspfad bei Katalogänderungen?
