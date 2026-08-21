/** A per-row outcome VTEX reports alongside an HTTP 200, not an error status. */
export interface VtexOrderFormMessage {
  code: string;
  text: string;
  status: 'error' | 'warning' | 'info' | (string & {});
  fields?: { id?: string; [field: string]: unknown } | null;
}

/** The rounding-safe prices. `sellingPrice` sits beside these and is not. */
export interface VtexOrderFormPriceDefinition {
  calculatedSellingPrice: number;
  total: number;
}

export interface VtexOrderFormItem {
  uniqueId: string;
  /** The SKU id — a canonical `ProductVariant` id. */
  id: string;
  productId: string;
  name: string;
  skuName?: string | null;
  refId?: string | null;
  ean?: string | null;
  quantity: number;
  seller?: string | null;
  price: number;
  listPrice?: number | null;
  sellingPrice?: number | null;
  priceDefinition?: VtexOrderFormPriceDefinition | null;
  imageUrl?: string | null;
  detailUrl?: string | null;
  availability?: string | null;
  measurementUnit?: string | null;
  /** Step size the SKU is sold in; a six-pack carries 6. */
  unitMultiplier?: number | null;
  additionalInfo?: { brandName?: string | null } | null;
}

export interface VtexOrderFormTotalizer {
  id: string;
  name: string;
  value: number;
}

export interface VtexOrderForm {
  orderFormId: string;
  salesChannel: string;
  /** The whole cart in minor units. */
  value: number;
  items: VtexOrderFormItem[];
  messages: VtexOrderFormMessage[];
  totalizers: VtexOrderFormTotalizer[];
  storePreferencesData?: { currencyCode?: string | null } | null;
  shippingData?: { selectedAddresses?: unknown[] | null } | null;
}

/** The body `POST /orderForm/{id}/items` takes. `seller` is required; omitting it answers 400. */
export interface VtexOrderItemAdd {
  id: string;
  quantity: number;
  seller: string;
}

/** The body `POST /orderForm/{id}/items/update` takes. It accepts an index and nothing else. */
export interface VtexOrderItemUpdate {
  index: number;
  quantity: number;
}
