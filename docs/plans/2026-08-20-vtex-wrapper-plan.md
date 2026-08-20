# Plan: `@laioutr/app-vtex` — Laioutr Orchestr Wrapper für die VTEX Commerce Platform

## Kontext

`app-vtex` ist ein Laioutr App (Nuxt-Modul), das VTEX als Commerce-Backend an eine Laioutr
Storefront anbindet. Referenz-Implementierung ist `app-shopware` (`@laioutr/app-shopware`), das
denselben Core-Stand fährt.

Kontospezifisches — Sandbox-Inhalt, verifizierte Hosts, API-Fallstricke, npm- und CI-Stand —
steht in [`docs/environment.md`](../environment.md) und wird hier nicht wiederholt.

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
  salesChannel?: string;                          // Fallback, default '1'
  salesChannelByMarket?: Record<string,string>;   // Market-Slug -> Sales-Channel-Id
  searchProvider?: 'legacy' | 'intelligent';      // default 'legacy'
}
```

**Markt -> Sales Channel wird explizit gemappt**, nicht über die Währung erraten. `clientEnv.market`
liefert `id`, `slug`, `name`, `currency` und Regionscodes; die Auflösung ist
`salesChannelByMarket?.[market.slug] ?? salesChannel`. Ein Währungs-Match wäre bequemer, greift aber
daneben, sobald zwei Trade Policies dieselbe Währung führen (B2B/B2C) — und er bräuchte einen
`adminFetch` beim Start, weil Sales Channels nur auf dem privaten Pfad auflistbar sind.

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

Beide nehmen eine **API-Kennung statt eines rohen Pfads** entgegen
(`publicFetch('catalogSystem', '/api/...')`), damit die Host-Auflösung aus Abschnitt 2 an genau
einer Stelle liegt und nicht in jeden Handler sickert, der einen Preis anfasst.

`publicFetch` reicht `Set-Cookie` via `setCookie(event, …)` zurück. **`adminFetch` leitet bewusst
keine Kunden-Cookies weiter** — ein Server-zu-Server-Call soll keine Shopper-Identität tragen, sonst
löst VTEX einen anderen Kontext auf als gemeint.

Die Factory macht **keinen einzigen Netzwerk-Call**. Sie liest eingehende Cookies, leitet
`isAuthenticated` aus deren Vorhandensein ab, löst den Sales Channel rein rechnerisch auf und baut
die Fetcher als Closures. Das erzwingt der Builder-Vertrag aus Abschnitt 4.

Fehler: der Client wirft einen typisierten `VtexApiError` mit Status, API-Kennung und geparstem
Body. Das Mapping auf kanonische Fehler bleibt im Handler — ob ein 404 ein `ProductNotFoundError`
oder ein `CategoryNotFoundError` ist, weiß nur der Aufrufer.

**`JSON.stringify(clientEnv)` wirft.** `market`, `language` und `domain` sind zyklisch verkettet.
Logging- und Fehler-Helfer müssen Felder einzeln herausgreifen, nie das ganze Objekt serialisieren.

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
│   ├── orderForm.ts               # OrderForm-Lifecycle
│   ├── masterdata.ts              # MasterData-Zugriff (CL, AD, wishlist)
│   ├── money.ts                   # VTEX-Preis → Money
│   └── mappers/
├── search/
│   ├── types.ts                   # SearchProvider-Interface
│   ├── legacy.ts                  # Adapter auf catalog_system
│   └── intelligent.ts             # Adapter auf VTEX IO, sobald der Store aktiv ist
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

### 5.1 Such-Provider-Abstraktion

Suche, PLP und Facetten laufen nicht direkt gegen eine VTEX-API, sondern gegen ein Interface. Die
Handler bleiben an ihre kanonischen Tokens gebunden; nur das, was darunter aufgerufen wird, variiert.

```ts
export interface SearchProvider {
  readonly id: 'legacy' | 'intelligent';

  /** Liefert IDs und Total. Die Hydration ist Sache des Resolvers. */
  searchProducts(input: {
    term?: string;
    categoryPath?: string;        // '/2/3/' — legacy fq=C:, IS selectedFacets
    from: number; to: number;
    salesChannel: string;
  }): Promise<{ productIds: string[]; total: number }>;

  facets(input: {
    term?: string; categoryId?: string; salesChannel: string;
  }): Promise<AvailableFilter[]>;

  /** Optional — Legacy Search hat kein Autocomplete. */
  suggestions?(input: { term: string }): Promise<SuggestionResult>;
}
```

Drei bewusste Entscheidungen:

- **`suggestions` ist optional statt einer werfenden Methode.** Damit ist das Fehlen von
  Autocomplete eine Typ-Eigenschaft: `SuggestedSearchSearchQuery` wird schlicht nicht registriert,
  wenn der aktive Provider sie nicht hat, statt zur Laufzeit zu scheitern.
- **Queries liefern IDs und Total, nie Produkte.** Das ist der schmalste Vertrag, auf den sich beide
  Adapter einigen müssen, und deckt sich mit dem Orchestr-Query-Kontrakt.
- **Die Provider-Wahl ist Konfiguration, kein Probe-Call.** `searchProvider` in den `ModuleOptions`,
  Default `'legacy'`. Ein Capability-Probe wäre nur über einen absichtlich scheiternden Request
  feststellbar — das ist schlechter als eine deklarierte Einstellung.

Der Legacy-Adapter mappt `Departments`, `Brands`, `CategoriesTrees` und `PriceRanges` auf
`AvailableFilter`, damit die Storefront die Form bekommt, die sie ohnehin konsumiert.

---

## 6. Kanonische Bindungen

Vollständige Liste dessen, was implementiert wird. Links steht das Token aus
`@laioutr-core/canonical-types/ecommerce` (bzw. `/core`), rechts der VTEX-Zugriff.

### 6.1 Product
| Token | Datei | VTEX |
|---|---|---|
| `ProductBySlugQuery` | `product/bySlug.query.ts` | `GET /api/catalog_system/pub/products/search/{slug}/p` — Slug ist `linkText`, siehe unten |
| `ProductsByCategoryIdQuery` | `product/byCategoryId.query.ts` | Such-Provider (5.1); Legacy: `products/search?fq=C:/{pfad}/` |
| `ProductsByCategorySlugQuery` | `product/byCategorySlug.query.ts` | dito, Slug→ID über den Category-Tree |
| `ProductSearchQuery` | `product/search.query.ts` | Such-Provider (5.1); Legacy: `products/search?ft={term}` |
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
`ProductMedia`, `ProductPrices`, `ProductSeo`, `ProductFlags`, `ProductDefaultVariant`,
`ProductBrand`, `ProductSpecifications`, `ProductOptionGroups`.

`ProductRating` ist **bewusst noch nicht dabei**: es stammt aus
`/reviews-and-ratings/api/rating/{productId}` und kommt mit der Review-Arbeit. Eine Komponente zu
deklarieren, die man nicht auflösen kann, scheitert zur Request-Zeit statt bei der Registrierung.

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
| `CategoryProductsLink` | `category/products.link.ts` | Such-Provider (5.1) |
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

### 6.8 Suggested Search — **blockiert**

| Token | VTEX |
|---|---|
| `SuggestedSearchSearchQuery` | `GET /api/io/_v/api/intelligent-search/search_suggestions` |
| `SuggestedSearchEntriesLink`, `SuggestedSearchProductsLink` | `top_searches`, `correction_search` |

Diese Handler lassen sich derzeit **nicht bauen**. Alle drei Endpunkte gehören zu Intelligent
Search, das auf dem Konto nicht aktiv ist, und Legacy Search hat kein Gegenstück für Autocomplete.
Sie kommen, sobald der Store aktiviert ist — das Interface aus 5.1 hält den Platz dafür offen.

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
- **Suggested Search / Autocomplete** — nicht grundsätzlich ausgeschlossen, aber derzeit nicht
  baubar: Intelligent Search ist auf dem Konto nicht aktiv und Legacy Search hat kein Gegenstück
  (Abschnitt 6.8).
- **Catalog-Admin-Reads als eigene Handler** — Seller, Supplier, SpecificationGroup, SKU-EAN/Kit/
  Attachment/Service/Complement, Collection, Subcollection, Product-Indexing. Das sind interne
  Client-Bausteine unter `vtex-helper/catalog/`, die `ProductSpecifications`, `ProductBrand` und die
  Variant-Komponenten speisen.
- **Pricing-API als eigene Handler** — fließt in `ProductPrices`, `ProductVariantPrices`,
  `ProductVariantQuantityPrices`.
- **Session-Manager als eigene Handler** — Infrastruktur des Clients, keine Query.

---

## 13. Umsetzungsreihenfolge

**Diese Runde — der vollständige Lesepfad.** Mutationen bleiben aussen vor.

1. ~~`peerDependencies` um `@laioutr-core/kit` und `@laioutr-core/orchestr` ergänzen.~~ erledigt
2. ~~`ModuleOptions` und RuntimeConfig in `src/module.ts`.~~ erledigt; `salesChannelByMarket` und
   `searchProvider` kommen noch dazu
3. **Testdaten seeden** (Abschnitt 13a) — zuerst, damit alles danach überhaupt prüfbar ist.
4. Client-Schicht: `cookies.ts`, `vtexClientFactory.ts` mit Host-Auflösung pro API, `types.ts`.
5. `money.ts` und die Mapper — vor allem, was Preise anfasst.
6. `defineVtex.ts` mit namespaced Context, Markt-Map und lazy Session.
7. Such-Provider: Interface plus Legacy-Adapter (Abschnitt 5.1).
8. Category-Tree-Helper plus `category/`- und `menu/`-Handler.
9. Product und ProductVariant: Queries, Links, Resolver, Composition-Helper, Passthrough-Tokens.
10. Page-Indexes für `ProductDetailPage`, `ProductListingPage`, `ProductSearchPage`.
11. Query-Templates für `ProductsByCategorySlugQuery` und `MenuByAliasQuery`.
12. Fehler-Mapping über alle Handler ziehen.

**Danach, eigene Runden.** Cart und CartItem (Cookie-Handling kritisch) · Auth, Customer, Address ·
Review plus `ProductRating` · ProductList/Wishlist auf MasterData · Order · Suggested Search und der
Intelligent-Search-Adapter, sobald der Store aktiv ist.

---

## 13a. Testdaten

Der Katalog enthält heute genau ein verwendbares Produkt. Damit lassen sich Listing, Facetten,
Pagination und Varianten nicht sinnvoll prüfen — eine Stichprobe von eins beweist nichts.

`scripts/seed-sandbox.ts` legt deshalb einen kleinen Fixture-Satz an: 6–8 Produkte über den
bestehenden `Damen > Schuhe > Sneaker`-Ast plus einen zweiten Ast, damit `ChildCategoriesLink` und
Breadcrumbs echte Geschwister und Tiefe haben; **gestreute Preise**, damit `PriceRanges` überhaupt
Werte bekommt (heute leer, weil ein Produkt genau einen Preis hat); ein Produkt mit drei SKUs für
`ProductVariantsLink` und `ProductVariantOptions`.

Die Reihenfolge pro Produkt ist nicht frei wählbar:

    Produkt anlegen -> SKU anlegen -> Bild anhängen -> Preis -> Bestand -> SKU aktivieren

VTEX verweigert die Aktivierung einer SKU ohne Datei, und der File-by-URL-Endpunkt quittiert
sporadisch mit einem 500er SQL-Timeout — das Skript braucht Retries, kein Vertrauen in den ersten
Versuch. Nach dem Seeding dauert es, bis die Suche die Produkte kennt.

Das Skript wird eingecheckt, damit der Fixture-Satz reproduzierbar bleibt; `files: ["dist"]` hält es
aus dem npm-Paket heraus.

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
- **Unit-Tests (Vitest)** gegen gemocktes `fetch`: Host-Auflösung (Pricing landet auf
  `api.vtex.com`, alles andere auf der Account-Domain), Cookie-Weitergabe in `publicFetch` und
  ausdrücklich **keine** in `adminFetch`, beide Money-Richtungen, Tree-Traversal und Slug->ID,
  Legacy-Facetten -> `AvailableFilter`, Sales-Channel-Auflösung aus der Markt-Map. Keine
  Komponenten-Tests.

---

## 15. Offene Punkte

1. **MasterData-ACL** — darf der Customer-Token direkt in `wishlist`, `CL` und `AD` schreiben, oder
   braucht es durchgängig `adminFetch` mit `shopperId` aus dem Auth-Cookie?
2. ~~Facetten-Quelle~~ — **entschieden:** Legacy-Search-Facetten
   (`facets/search/{term}?map=ft`, `facets/category/{id}`). Intelligent Search steht auf diesem
   Konto nicht zur Verfügung, und Category Specifications würden je PLP einen `adminFetch` kosten.
   Der Legacy-Endpunkt liefert `Departments`, `Brands`, `CategoriesTrees` und `PriceRanges` und wird
   auf `AvailableFilter` gemappt. `map` ist Pflicht — fehlt er, antwortet die API mit 400.
3. **Sales-Channel und Locale pro Request** — Ableitung aus `clientEnv` festlegen, inklusive
   Fallback, wenn ein Markt keinen Sales-Channel gemappt hat.
4. ~~Tree-Cache-Invalidierung~~ — **entschieden:** Nitro-Cache mit 10 Minuten TTL und **ohne**
   Invalidierungspfad. Eine Invalidierung bräuchte einen Katalog-Webhook, den es hier nicht gibt;
   der Baum ändert sich selten genug, dass eine kurze TTL der ehrlichere Kompromiss ist.
5. **Intelligent Search aktivieren** — sämtliche IO-Endpunkte antworten mit HTTP 400 und
   `"Store is not active."`, auch mit gültigem Suchbegriff. Das ist Store-Provisioning, keine
   Parameterfrage. Solange das offen ist, laufen Suche und PLP über den Legacy-Adapter und
   Autocomplete existiert nicht.
