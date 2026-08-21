# @laioutr/app-vtex

## 0.3.0

### Minor Changes

- e187f23: **Cart** — the VTEX Checkout orderForm behind the canonical `Cart` and `CartItem` entities. Read the
  current cart, add product items, change quantities, remove lines, and send the shopper to VTEX's
  checkout. A cart is created on the first add rather than on first sight, so a visitor who never
  shops is never given one.

  The storefront now sets one first-party cookie, `checkout.vtex.com`, holding the shopper's cart id
  for 180 days as `HttpOnly; SameSite=Lax`. It is written only when a cart is created — worth knowing
  if you maintain a cookie policy or a consent banner. VTEX's own session and segment cookies are no
  longer passed on to the browser: they carried VTEX's domain, so no browser ever accepted them, and
  nothing in the app reads them back.

  Discount codes, SKU quick-order rows and custom line items are reported as rejected rather than
  silently ignored; VTEX shipping, addresses and coupons are not covered yet.

## 0.2.0

### Minor Changes

- d9b7324: Initial release. Reads a VTEX catalog into a Laioutr storefront: categories, menus, products,
  product variants, search and search suggestions, all bound to canonical Orchestr tokens, plus the
  page-indexes that give product detail, category listing and search pages their URLs.

  Configure the app with your account and a sales channel:

  ```ts
  export default defineNuxtConfig({
    modules: ['@laioutr/app-vtex'],
    '@laioutr/app-vtex': {
      accountName: 'my-account',
      environment: 'vtexcommercestable',
      appKey: process.env.VTEX_APP_KEY,
      appToken: process.env.VTEX_APP_TOKEN,
      salesChannel: '1',
    },
  });
  ```

  `salesChannelByMarket` maps a market slug to a different sales channel where a storefront serves
  several trade policies. Search runs on VTEX's Legacy Search: the `searchProvider` option is in place
  for an Intelligent Search adapter that does not ship yet, so `'intelligent'` type-checks but changes
  nothing. Search suggestions come from full-text search too, because Legacy Search has no
  autocomplete endpoint.

  Images served from VTEX's file store resize on VTEX's own CDN through a `vtex` Nuxt Image provider.
  In Studio, menus and category listings offer labelled query templates — the category tree, each
  entry shown with its full trail — so an editor picks a category instead of typing an id.

  A category's slug is its full path (`herren/schuhe`), not its last segment — VTEX category names
  repeat across the tree, and a last-segment slug would address several categories at once.

  Cart, checkout, authentication, customer, orders and reviews are not part of this release.
