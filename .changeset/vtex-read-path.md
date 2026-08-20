---
'@laioutr/app-vtex': minor
---

Read a VTEX catalog into a Laioutr storefront: categories, menu, products, product variants and
search, plus the page-indexes that give products and category listings their URLs.

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
several trade policies. `searchProvider` selects the search backend and defaults to `legacy`;
`intelligent` requires an active VTEX IO store on the account.

A category's slug is its full path (`herren/schuhe`), not its last segment — VTEX category names
repeat across the tree, and a last-segment slug would address several categories at once.
