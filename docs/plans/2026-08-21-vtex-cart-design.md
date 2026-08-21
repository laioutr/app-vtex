# Design: Cart and CartItem for `@laioutr/app-vtex`

Binds the canonical `Cart` and `CartItem` entities to VTEX's Checkout orderForm. This is the app's
first mutation path; the read path is already in place.

Read alongside [`docs/environment.md`](../environment.md) for account state and API traps, and
[`2026-08-20-vtex-wrapper-plan.md`](./2026-08-20-vtex-wrapper-plan.md) §6.4 for the token table this
design fills in.

## Scope

In: `type: 'product'` line items, the full cart read path, the three mutations, the checkout URL.

Out this round, reported as `rejected` / `not-supported` rather than silently dropped:
`discount-code`, `sku` and `custom` rows. Coupons are deferred because VTEX accepts an invalid code
with HTTP 200, no message and a populated `marketingData.coupon` — see the evidence table — so
`DiscountCodeNotRedeemableError` could only be inferred from an unchanged `ratesAndBenefitsData`.
That is worth doing deliberately, not as a side effect of the cart round.

Also out: shipping simulation, `clientProfileData`, addresses, and the anonymous-to-customer merge,
which needs Auth.

## Verified VTEX behaviour

Measured against `laioutrpartner` on 2026-08-21. Every design decision below rests on one of these.

| Behaviour | Evidence |
|---|---|
| `POST /api/checkout/pub/orderForm` with the `checkout.vtex.com` cookie returns the **same** cart; without it, mints one and sends `Set-Cookie` | same `orderFormId` returned on a second call carrying the cookie |
| Line items carry a stable `uniqueId`, unchanged across quantity updates | `69F675…` survived a 2 → 3 quantity update |
| `items/update` accepts **`index` only** | `uniqueId` → `400 CHK0041` *Ungültiger Artikelindex*; `PATCH /items` with `uniqueId` → `400 CHK0022` *Artikel-ID ist erforderlich* |
| Indices **shift** on removal | removing index 0 of two lines moved the survivor from index 1 to 0 |
| Multiple indices in **one** `items/update` payload are applied against the original indexing, atomically | removing indices 0 and 2 of three lines left exactly the middle line |
| `seller` is **required** on add | omitting it → `400 CHK0024` *Ungültiger Verkäufer für Artikel* |
| An unknown SKU is **HTTP 200**, not an error status | `messages: [{code:'ORD027', status:'error', fields:{id:'999999999'}}]`, cart otherwise unchanged |
| Over-stock adds are **silently clamped** | 9999 requested → line present at quantity 50, `messages: [{code:'itemMaxQuantityLimitReached', status:'info'}]` |
| `messages` are **sticky** — they persist indefinitely across reads | the same two messages returned by three consecutive reads, including a fresh `POST /orderForm` |
| `POST .../messages/clear` empties them **and returns the full orderForm** | response carried 35 keys, `items` (2), `value` and `orderFormId` |
| Money is minor units; currency is in `storePreferencesData.currencyCode` | `price: 4999`, `value: 9998` for 2 × EUR 49.99; `currencyCode: "EUR"` |
| Only an `Items` totalizer exists until a shipping address is set | `totalizers: [{id:'Items', name:'Items Total', value:17997}]` |
| VTEX's `Set-Cookie` carries `domain={account}.vtexcommercestable.com.br` | the browser rejects it on the storefront's origin — see below |
| An invalid coupon is accepted silently | `POST .../coupons` with a bogus code → 200, `messages: []`, `marketingData.coupon` set to the bogus code |

## 1. Cookies

**The current passthrough is broken and nothing has noticed.** `vtexClientFactory` hands each raw
upstream `Set-Cookie` to `onSetCookie`, which appends it verbatim. VTEX stamps its own domain on
that header, so the browser drops the cookie on the storefront's origin — `localhost` included. The
read path never depended on a VTEX cookie surviving the round trip. The cart cannot work at all
until this is fixed.

`vtexClientFactory.ts` itself does not change. Instead:

- `client/cookies.ts` gains `parseVtexSetCookie(raw)`, which returns `{ name, value, expires }` for
  the names already on the forwarding allowlist and `undefined` for anything else. It delegates to
  `parseSetCookie` from `cookie-es`, added as a direct dependency. A hand-rolled `split('=')` is
  wrong here: the orderForm value is `__ofid=<id>`, so the value itself contains `=`.
- `middleware/defineVtex.ts` composes the two — `onSetCookie: (raw) => { … setManagedCookie(…) }`.

Attributes are ours, not VTEX's: `httpOnly: true`, `path: '/'`, `sameSite: 'lax'`, carrying VTEX's
`expires` through. `setManagedCookie` from frontend-core owns `secure` and `partitioned`.

Two reasons `setManagedCookie` rather than a corrected raw header:

1. **The Studio preview frame is cross-site.** A `SameSite=Lax` cart cookie is never sent back from
   it, so an editor would see a permanently empty cart. `resolveCookieOptions` upgrades the cookie
   to `SameSite=None; Secure; Partitioned` inside that frame and only there.
2. `secure` tracks whether the origin can carry it, so the playground on `http://localhost` works
   without a special case.

`sameSite: 'lax'` rather than app-shopify's `'strict'`: `GetCheckoutUrlAction` sends the shopper to
VTEX's checkout domain, and `strict` drops the cookie on the top-level GET back.

The value round-trips through percent-encoding — h3 writes `__ofid%3D…` and `parseCookies` decodes
it — so `forwardableCookieHeader`, which builds from `parseCookies`, keeps sending VTEX the decoded
form it expects. No change needed there.

`deleteManagedCookie` clears the cookie when the stored orderForm id 404s, so an expired cart is
not retried on every subsequent request.

## 2. `vtex-helper/orderForm.ts`

One module owns the lifecycle. No handler calls `/checkout/pub` directly.

| Export | Behaviour |
|---|---|
| `parseOrderFormId(cookieValue)` | strips the `__ofid=` prefix. No I/O. |
| `createOrderForm(client)` | `POST /orderForm`. Actions only. Needs no explicit cookie write — VTEX answers with a `Set-Cookie` and §1 already routes it. |
| `readOrderForm(client, id)` | `GET /orderForm/{id}`. A 404 warns and returns `undefined`; the caller clears the cookie. Any other status rethrows — see §7. |
| `clearMessagesAndRead(client, id)` | `POST /orderForm/{id}/messages/clear`. Returns the full orderForm. |
| `indexByUniqueId(orderForm)` | `Map<uniqueId, index>`. |
| `toOrderItemUpdates(rows, index)` | canonical rows → VTEX's `{ index, quantity }`, skipping a line the snapshot no longer holds. |
| `toBatchResults(requested, before, after)` | VTEX `messages` plus a quantity diff → `CartBatchResultItem[]`. |

The helper takes cookie **values** rather than the h3 event, so it stays free of `#imports` and is
testable without booting Nitro. Handlers own the cookie writes. `CartBatchResultItem` is derived
from `CartAddItemsAction`'s output type — `canonical-types` exposes no import path for it.

`clearMessagesAndRead` is the load-bearing one. Because the clear response carries the whole
orderForm, it is simultaneously the message reset and the pre-mutation snapshot that the index map
and the quantity diff are built from. Every mutating action opens with it, and index resolution
therefore costs no extra request.

The orderForm goes into a passthrough token, `'@laioutr/app-vtex/orderForm'`, so the query, both
resolvers and both links share one fetch — the pattern `loadedProductsToken` already establishes.

`types/vtexCheckout.ts` hand-writes the orderForm subset this app reads. VTEX's Checkout OpenAPI
schema is authored but declares only 8 component schemas across 37 paths, so generating from it
would yield inline shapes rather than named types — the same judgement `VtexProduct` already
reflects.

## 3. Line-item identity

Canonical `CartUpdateItemsAction` and `CartRemoveItemsAction` take back an `itemId` the frontend
read off a `CartItem`. VTEX addresses lines by index, and indices shift.

**`CartItem.id` is the VTEX `uniqueId`, resolved to an index at mutation time.** Each action builds
the map from the snapshot it already has, translates the input, and issues one `items/update`. A
`uniqueId` absent from the snapshot means the line is already gone: it is skipped, never translated
into some other line's index.

The alternative — handing out the index — was rejected. An index is true only for the snapshot the
frontend last rendered, so a double-click, a second tab, or any removal makes a delete hit the wrong
line, and the shopper loses an item they did not touch. Synthesised ids with a server-side map were
rejected too: they need per-session storage the app does not have, to solve a problem `uniqueId`
already solves for free.

## 4. Read path

**`cart/get-current.query.ts`** — no cookie → `{ id: undefined }` and **zero VTEX calls**. VTEX has
no read-only orderForm mode, so an eager resolve would mint a cart and set a cookie on every first
page view that renders a cart badge, including bot traffic. With a cookie → `readOrderForm`, set the
passthrough, return `{ id }`.

`{ id: undefined }` means **verified to have no cart** — no cookie, or a 404 proving the orderForm is
gone. It must never stand in for "the read failed", because a shopper shown an empty cart that holds
three items re-adds them and double-orders. Any other failure rethrows, attributed with the
orderForm id.

**`cart/cart-items.link.ts`** — `targetIds` = `items.map(uniqueId)` from the passthrough.

**`cart/base.resolver.ts`** — `CartBase` + `CartCost`.

- `totalQuantity` sums the line quantities.
- `checkoutLink` is the URL `GetCheckoutUrlAction` builds.
- `subtotal` from the `Items` totalizer, falling back to the sum of the lines'
  `priceDefinition.total` — derived from the same numbers, not guessed. `total` from `orderForm.value`.
- `shipping` and `tax` only when their totalizers exist. On a cart without a shipping address only
  `Items` is present, so both are normally absent.
- `totalIsEstimated: true` until `shippingData` carries a selected address, because until then
  `value` genuinely excludes shipping. `subtotalIsEstimated: false`.
- `duty` and `taxes` are not modelled — VTEX exposes no source for either here.

Currency comes from `storePreferencesData.currencyCode`, **not** `clientEnv.market.currency` as the
product resolvers use. The cart is what the shopper is charged: if a sales channel prices in a
currency the market disagrees with, the cart must report what VTEX actually charged. The divergence
is deliberate and belongs only to the transactional path.

**`cart-item/base.resolver.ts`** — `CartItemBase`, `CartItemCost`, `CartItemAvailability`,
`CartItemQuantityRule`, `CartItemProductData`.

Each line maps inside its own guard. A line VTEX returns in a shape the mapper cannot handle is
dropped from `entities` with a warning naming its `uniqueId`, exactly as `prices.resolver.ts`
already drops a variant with no seller. One malformed line costs that line, never the cart.

- base: `type: 'product'`, `title: name`, `subtitle: skuName`, `brand: additionalInfo.brandName`,
  `code: refId`, `link` from `detailUrl` (`/laioutr-test-sneaker/p` → a `Product` reference),
  `cover` from `imageUrl` as a `vtex`-provider source. `link` and `cover` are both optional in the
  token, so a `detailUrl` or `imageUrl` that does not parse is omitted with a warning rather than
  costing the line.
- cost: `single` from `priceDefinition.calculatedSellingPrice`, `total` from `priceDefinition.total`
  — never `sellingPrice`, which VTEX documents as not rounding-safe. `subtotal` is `price ×
  quantity`, before promotions. `singleStrikethrough` is `listPrice` when it exceeds `single`; SKU
  756290 is a live case at `listPrice 7999` against `price 5999`.
- availability: `available` → `inStock`, every other VTEX status → `outOfStock`.
- quantityRule: `min: 1`, `increment: unitMultiplier`, `canChange: true`. `max` stays undefined —
  VTEX enforces a per-item cap but does not report it in the orderForm.
- productData: a `unitPrice` only when `unitMultiplier !== 1`; otherwise undefined.

The orderForm's `imageUrl` bakes a `-55-55` size into the `/arquivos/ids/` segment. The image
provider's regex already replaces an existing size suffix, so a sized request is correct as-is; the
mapper strips the suffix anyway so an unsized request gets the original rather than a thumbnail.

**`cart-item/product-variant.link.ts`** — `targetId = item.id`, the SKU id, which is exactly the
`ProductVariant` entity id `loadVariants` keys on.

**No `cache` block on either resolver.** Every other resolver in this app has one; their absence
here is the point. A cart is per-shopper and changes on every mutation, so any shared cache entry
is a correctness bug, not a slow path.

## 5. Actions

All three mutations open with `clearMessagesAndRead`, so every message in the response is
attributable to that call rather than to something the shopper did ten minutes ago.

**`add-items.action.ts`**

1. Non-product rows out immediately as `rejected` / `not-supported`.
2. No orderForm id → `createOrderForm`, which writes the cookie.
3. `clearMessagesAndRead` for the pre-add snapshot.
4. **One batched `searchByIds(client, 'skuId', variantIds)`** to resolve each SKU's seller from
   `sellers[].sellerDefault`. `seller` is required and canonical input has no field for it.
   Hardcoding `'1'` would be correct only on a single-seller account; the lookup is correct on a
   marketplace, reuses an existing helper, costs one call on a user-initiated mutation rather than
   on any page view, and yields `rejected` / `not-found` for free on a SKU that does not resolve.
   A SKU that resolves with exactly one seller uses that seller. One that resolves with several and
   no `sellerDefault` is **rejected** as `not-orderable`, not guessed at: picking a seller decides
   which offer and which price the shopper gets, and §7 puts money on the fail-hard side.
5. `POST /orderForm/{id}/items?sc={salesChannel}`.
6. Map to `CartBatchResultItem[]`: `ORD027` with `fields.id` → `rejected` / `not-found`; everything
   else → `added` with the quantity actually present after the call, taken from the before/after
   diff. A clamp is an `added` row with a smaller quantity, which is what the canonical field
   documents, not an error.
7. Return the batch result. Actions **cannot** write the passthrough store — `OrchestrArgsAction`
   carries no `passthrough` — so the updated cart reaches the storefront through the next
   `GetCurrentCartQuery`, not through this response.

**`update-items.action.ts`** — snapshot, `uniqueId → index`, one `items/update` carrying every row
whose `quantity` is defined and whose `uniqueId` is present. `customFields` are ignored; the token
documents unsupported features as ignored. No orderForm id throws — a client updating a cart that
does not exist is a bug, not a shopper state.

**`remove-items.action.ts`** — the same, with `quantity: 0`. One call for all indices, because a
multi-index payload is atomic against the original indexing.

**`get-checkout-url.action.ts`** — `https://{account}.{environment}.com.br/checkout/?orderFormId={id}#/cart`.
The id rides in the URL because our orderForm cookie is first-party to the storefront and VTEX's
checkout domain cannot see it. With no cart, the same URL without the parameter.

## 6. Errors

Per-item outcomes are `CartBatchResultItem` rows, never throws — VTEX reports them as 200 plus
`messages`, and the canonical token documents them as normal per-row outcomes.

`CartAddItemsAction` is explicit that unknown SKUs, sold-out items and adjusted quantities are
per-row outcomes rather than throws, and VTEX reports all three as 200 plus `messages`. The two
contracts agree, so `add-items` throws for none of them:

| VTEX signal | Row |
|---|---|
| `ORD027` with `fields.id` | `rejected` / `not-found` |
| SKU unresolvable in the seller lookup | `rejected` / `not-found` |
| SKU resolves with several sellers and no `sellerDefault` | `rejected` / `not-orderable` |
| item `availability` reports no stock | `rejected` / `sold-out` |
| `itemMaxQuantityLimitReached`, line present at a lower quantity | `added` with the quantity actually present |

A consequence: the canonical `ProductNotFoundError`, `ProductStockError` and `ProductQuantityError`
classes barely fire on this connector. They exist for backends that fail the whole call on one bad
row; VTEX does not, so routing those conditions through the batch result is the more faithful
mapping. `update-items` has no batch output, so a quantity VTEX clamps there is warned rather than
reported — the next cart read shows the true quantity.

What does throw, per §7: a VTEX 5xx or network failure, a whole-call `400` such as `CHK0024`
surviving seller resolution, a wholesale failure of the seller lookup, and an update or removal
against a cart that does not exist. A 404 on the stored orderForm id is not an error — the cookie is
cleared and the shopper has no cart.

## 7. Failure policy

`.claude/rules/fail-soft-resilience.md` governs this app. The orderForm is upstream data we do not
control, so the split is explicit.

**Reads degrade, per line.** The `CartItem` resolver guards inside its map, so the blast radius of a
malformed line is that line. Every fallback warns, naming the `uniqueId` or `orderFormId` and what
was substituted — a silent fallback moves the debugging to someone with less context.

**Money never guesses.** Three guards, all of which the rule names directly:

- `fromMinorUnits` wraps `new Money(…)`. `currency` comes from `storePreferencesData.currencyCode`,
  which is upstream data; ts-money throws on a code it does not know, and unguarded that single
  value blanks the whole cart — the Magento `fromDecimal` archetype exactly. The degradation is to
  drop `CartCost` and every `CartItemCost` with a warning naming the code, keeping `CartBase` and
  `CartItemBase` so the cart still lists what is in it. Substituting a currency is not available:
  it would misprice the cart rather than degrade it.
- A missing or non-numeric `priceDefinition` yields `NaN` cents, which is corruption rather than
  degradation. The line is dropped with a warning instead of being priced from `sellingPrice`, which
  VTEX documents as not rounding-safe.
- `parseVtexSetCookie` returns `undefined` for anything it cannot parse and never throws. A cookie
  header we cannot read must not take down the request that carried it.

**Mutations fail hard, attributed.** An add-to-cart that reports success without adding is worse
than one that fails: the shopper believes they have the item. So the three actions throw on
whole-call failure, and the error names the orderForm id and the SKU. The per-row outcomes VTEX
reports as 200 plus `messages` are a different thing entirely and stay `CartBatchResultItem` rows.

Two consequences worth stating because they read as inconsistencies otherwise:

- A `uniqueId` missing from the snapshot is a **skip with a warning**, not a throw — the line is
  already gone, and the shopper's intent (remove it) is satisfied.
- A wholesale failure of the seller lookup throws rather than falling back, because every fallback
  available at that point decides a price.

Nothing in this design runs at module scope, so rule 4 does not bite here.

## 8. Verification

**Unit tests (Vitest, mocked `fetch`).** No component tests.

- `client/cookies.test.ts` — extend with the exact `Set-Cookie` line VTEX returned: assert `domain`,
  `secure` and `samesite` are dropped, and that name and value survive with the `=` inside the value
  intact.
- `vtex-helper/orderForm.test.ts` — `__ofid=` stripping; the index map; a `uniqueId` absent from the
  snapshot being skipped rather than translated; `mapMessages` turning `ORD027` into a `not-found`
  row and a clamp into an `added` row with the smaller quantity.
- fail-soft cases, spread across the three suites: an unknown `currencyCode` costing the cost components
  and nothing else; a line with no `priceDefinition` dropped while its siblings survive; a
  malformed `Set-Cookie` returning `undefined`; a missing `Items` totalizer falling back to the
  summed line totals. Each asserts the warning as well as the fallback — an unwarned fallback is
  the failure mode the rule is about.
- `vtex-helper/mappers/cart.test.ts` — minor units end to end; `singleStrikethrough` present for
  756290 and absent for a flat-priced SKU; `total` taken from `priceDefinition.total`; a cart with
  only an `Items` totalizer yielding no `shipping` and no `tax`; availability mapping; the image
  size suffix stripped.

**`playground/pages/cart.vue`** — a bare page, no styling, that drives the canonical tokens:
`fetchAction` for the three mutations, and a `QueryWireRequest` posted to `/api/orchestr/query` for
`GetCurrentCartQuery` with `CartItemsLink` and the base and cost components. The playground disables
`projectSecretKey`, so that endpoint is reachable.

It exists to catch what a mocked-fetch test cannot, because a mock only confirms my own assumptions:

- the cart cookie actually surviving a real browser round trip, and surviving it inside the Studio
  preview frame;
- index resolution staying correct after a removal reorders the remaining lines;
- the checkout URL adopting the orderForm when followed.

## 9. Files

Modified: `client/cookies.ts` · `middleware/defineVtex.ts` · `const/passthroughTokens.ts` ·
`package.json` (add `cookie-es`).

New: `types/vtexCheckout.ts` · `vtex-helper/orderForm.ts` · `vtex-helper/mappers/cart.ts` ·
`vtex-helper/checkoutUrl.ts` ·
`orchestr/cart/{get-current.query,cart-items.link,base.resolver,add-items.action,update-items.action,remove-items.action,get-checkout-url.action}.ts` ·
`orchestr/cart-item/{base.resolver,product-variant.link}.ts` · the three test files ·
`playground/pages/cart.vue` · a changeset.

## 10. Open points

1. **`CartItemAvailability.quantity` reports the line's own quantity, not free stock.** The
   orderForm carries a status but no stock number, and fetching one is an N+1 per cart render. VTEX
   clamps server-side, so a shopper cannot exceed stock regardless. Revisit if a component needs a
   real "only 2 left" figure.
2. **The checkout URL form is unverified in a browser.** `?orderFormId={id}#/cart` is the documented
   binding; the playground click-through is what confirms VTEX adopts it.
3. **Multi-seller offers for one SKU are not modelled.** The add path takes `sellerDefault` and
   ignores the rest. Canonical input carries no seller, so offering a choice would need a token that
   does not exist.
4. **Cart currency diverges from the product resolvers** by design, per §4. If the two ever
   disagree in production, the cart is right and the sales-channel mapping is wrong.
5. **The anonymous-to-customer cart binding is untested.** VTEX should bind the orderForm when the
   forwarded `VtexIdclientAutCookie` appears, needing no code here — but that cannot be verified
   until Auth lands.
