---
'@laioutr/app-vtex': minor
---

**Cart** — the VTEX Checkout orderForm behind the canonical `Cart` and `CartItem` entities. Read the
current cart, add product items, change quantities, remove lines, and send the shopper to VTEX's
checkout. A cart is created on the first add rather than on first sight, so a visitor who never
shops is never given one.

Also fixes VTEX session cookies being dropped by the browser: they were passed through carrying
VTEX's own domain, which no browser accepts on the storefront's origin. Nothing depended on them
before the cart did.

Discount codes, SKU quick-order rows and custom line items are reported as rejected rather than
silently ignored; VTEX shipping, addresses and coupons are not covered yet.
