---
'@laioutr/app-vtex': minor
---

**Cart** — the VTEX Checkout orderForm behind the canonical `Cart` and `CartItem` entities. Read the
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
