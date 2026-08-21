/**
 * Our orderForm cookie is first-party to the storefront, so VTEX's checkout on its own domain
 * cannot read it — the binding has to travel in the URL instead.
 */
export const checkoutUrlFor = (
  accountName: string,
  environment: string,
  orderFormId?: string
): string => {
  const base = `https://${accountName}.${environment}.com.br/checkout/`;
  return orderFormId ?
      `${base}?orderFormId=${encodeURIComponent(orderFormId)}#/cart`
    : `${base}#/cart`;
};
