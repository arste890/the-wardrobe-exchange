import type { ShippingClass } from './types';

/** Flat-rate US shipping, in cents, charged to the buyer at checkout. */
export const SHIPPING_CLASSES: Record<
  ShippingClass,
  { cents: number; label: string; examples: string }
> = {
  tops: { cents: 800, label: 'Tops & accessories', examples: 'shirts, blouses, scarves, small accessories' },
  bottoms_denim: { cents: 1200, label: 'Bottoms, denim & dresses', examples: 'trousers, jeans, skirts, dresses' },
  outerwear: { cents: 1200, label: 'Jackets & knitwear', examples: 'blazers, light jackets, sweaters' },
  coats_boots: { cents: 1800, label: 'Coats, boots & bags', examples: 'heavy coats, boots, structured bags' },
};

export const SHIPPING_SERVICE = 'USPS Ground Advantage, tracked';
export const SHIPPING_DAYS = { min: 3, max: 7 };
/** Dispatch window, business days. Phrased as "usually" everywhere — it is not a guarantee. */
export const HANDLING = { min: 3, max: 5 };
export const HANDLING_DAYS = HANDLING.max;
export const HANDLING_TEXT = `usually within ${HANDLING.min}–${HANDLING.max} business days`;
/** Orders at or above this amount ship with signature confirmation. */
export const SIGNATURE_THRESHOLD_CENTS = 50000;

export function shippingCents(cls: ShippingClass): number {
  return SHIPPING_CLASSES[cls].cents;
}

export function formatUSD(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}
