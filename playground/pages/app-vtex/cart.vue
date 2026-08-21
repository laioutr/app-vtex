<script setup lang="ts">
import {
  CartAddItemsAction,
  CartItemsLink,
  CartRemoveItemsAction,
  CartUpdateItemsAction,
  GetCheckoutUrlAction,
  GetCurrentCartQuery,
} from '@laioutr-core/canonical-types/ecommerce';
import { CartBase, CartCost } from '@laioutr-core/canonical-types/entity/cart';
import {
  CartItemAvailability,
  CartItemBase,
  CartItemCost,
  CartItemProductData,
  CartItemQuantityRule,
} from '@laioutr-core/canonical-types/entity/cart-item';
import { unwrapToken } from '@laioutr-core/core-types/orchestr';

// The same components the cart sheet asks for, so this page fails wherever that one would.
const query = {
  id: 'cart',
  queryName: GetCurrentCartQuery,
  components: [CartBase, CartCost],
  links: {
    [unwrapToken(CartItemsLink)]: {
      components: [
        CartItemBase,
        CartItemCost,
        CartItemProductData,
        CartItemAvailability,
        CartItemQuantityRule,
      ],
    },
  },
};

// Two SKUs of the same product, so a removal leaves a sibling whose index must shift.
const skus = [
  { productId: '137327', variantId: '756290', label: 'Rot 42' },
  { productId: '137327', variantId: '756291', label: 'Blau 43' },
];

const orchestr = useOrchestrStore();
const cart = ref<any>(undefined);
const log = ref<string[]>([]);

const load = async () => {
  orchestr.invalidateQuery(query.id);
  await orchestr.executeQueries([query as any]);
  const result = orchestr.getClientQueryResult(query as any);
  cart.value = result.status === 'ok' ? result.entities[0] : undefined;
};

const record = async (label: string, run: () => Promise<unknown>) => {
  try {
    log.value.unshift(`${label} → ${JSON.stringify(await run())}`);
  } catch (error) {
    log.value.unshift(`${label} ✘ ${error instanceof Error ? error.message : String(error)}`);
  }
  await load();
};

const lines = computed(
  () => cart.value?.links?.[unwrapToken(CartItemsLink)]?.entities ?? []
);

const add = (sku: (typeof skus)[number]) =>
  record(`add ${sku.label}`, () =>
    fetchAction(CartAddItemsAction, [
      { type: 'product', productId: sku.productId, variantId: sku.variantId, quantity: 1 },
    ])
  );

const setQuantity = (itemId: string, quantity: number) =>
  record(`quantity ${itemId} → ${quantity}`, () =>
    fetchAction(CartUpdateItemsAction, [{ itemId, quantity }])
  );

const remove = (itemId: string) =>
  record(`remove ${itemId}`, () => fetchAction(CartRemoveItemsAction, [itemId]));

const goToCheckout = async () => {
  const { checkoutUrl } = await fetchAction(GetCheckoutUrlAction);
  log.value.unshift(`checkout → ${checkoutUrl}`);
  window.location.href = checkoutUrl;
};

onMounted(load);
</script>

<template>
  <div style="font-family: monospace; padding: 1rem">
    <h1>VTEX cart probe</h1>

    <p>
      <button v-for="sku in skus" :key="sku.variantId" type="button" @click="add(sku)">
        add {{ sku.label }}
      </button>
      <button type="button" @click="load">reload</button>
      <button type="button" @click="goToCheckout">checkout</button>
    </p>

    <table border="1" cellpadding="4">
      <tbody>
        <tr v-for="line in lines" :key="line.id">
          <td>{{ line.id }}</td>
          <td>{{ line.components.base.title }} / {{ line.components.base.subtitle }}</td>
          <td>{{ line.components.cost.single.amount }} {{ line.components.cost.single.currency }}</td>
          <td>{{ line.components.base.quantity }}</td>
          <td>{{ line.components.availability.status }}</td>
          <td>
            <button type="button" @click="setQuantity(line.id, line.components.base.quantity + 1)">
              +1
            </button>
            <button type="button" @click="setQuantity(line.id, 9999)">9999</button>
            <button type="button" @click="remove(line.id)">remove</button>
          </td>
        </tr>
      </tbody>
    </table>

    <p>
      total quantity {{ cart?.components?.base?.totalQuantity ?? '—' }} · subtotal
      {{ cart?.components?.cost?.subtotal?.amount ?? '—' }} · total
      {{ cart?.components?.cost?.total?.amount ?? '—' }} · estimated
      {{ cart?.components?.cost?.totalIsEstimated ?? '—' }}
    </p>

    <h2>log</h2>
    <ol>
      <li v-for="(entry, index) in log" :key="index">{{ entry }}</li>
    </ol>
  </div>
</template>
