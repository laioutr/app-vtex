---
'@laioutr/app-vtex': minor
---

Initial release. Reads a VTEX catalog into a Laioutr storefront: categories, menus, products,
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
