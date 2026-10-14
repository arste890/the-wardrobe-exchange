// Map a site item onto eBay Inventory API shapes.

import type { Item, Category, ConditionGrade } from '@kw/shared/types';
import { CATEGORY_LABELS, CONDITION_LABELS, MEASUREMENT_LABELS } from '@kw/shared/types';
import { HANDLING_TEXT } from '@kw/shared/shipping';

/** eBay US leaf category ids (Clothing, Shoes & Accessories → Women). Adjust in admin later via Taxonomy API. */
export const EBAY_CATEGORY: Record<Category, string> = {
  outerwear: '63862', // Women's Coats, Jackets & Vests
  tops: '53159', // Women's Tops
  knitwear: '63866', // Women's Sweaters
  dresses: '63861', // Women's Dresses
  bottoms: '63863', // Women's Pants
  denim: '11554', // Women's Jeans
  shoes: '3034', // Women's Shoes
  bags: '169291', // Women's Bags & Handbags
  accessories: '4251', // Women's Accessories
};

export const EBAY_CONDITION: Record<ConditionGrade, string> = {
  new_with_tags: 'NEW',
  excellent: 'USED_EXCELLENT',
  very_good: 'USED_VERY_GOOD',
  good: 'USED_GOOD',
  fair: 'USED_ACCEPTABLE',
};

/** eBay price = site price × markup so the site is always the cheapest place to buy. */
export const EBAY_MARKUP = 1.12;

export function ebayPrice(item: Item): string {
  return (Math.ceil((item.price_cents * EBAY_MARKUP) / 100)).toFixed(2);
}

export function ebayTitle(item: Item): string {
  const t = `${item.brand} ${item.title} ${item.size_label ? `Size ${item.size_label}` : ''}`.replace(/\s+/g, ' ').trim();
  return t.slice(0, 80);
}

const esc = (s: string) => s.replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[ch]!);

/** Plain HTML description: no links, no mention of other channels (eBay policy). */
export function ebayDescription(item: Item): string {
  const flaws = item.flaws.length ? `<p><b>Condition notes:</b></p><ul>${item.flaws.map((f) => `<li>${esc(f.text)}</li>`).join('')}</ul>` : '<p>No flaws to note.</p>';
  const meas = Object.entries(item.measurements)
    .filter(([, v]) => typeof v === 'number')
    .map(([k, v]) => `<li>${esc(MEASUREMENT_LABELS[k] ?? k)}: ${v} cm</li>`)
    .join('');
  return [
    `<p><b>${esc(item.brand)} — ${esc(item.title)}</b></p>`,
    `<p>Size ${esc(item.size_label)}${item.size_system ? ` (${esc(item.size_system)})` : ''} · ${esc(CONDITION_LABELS[item.condition_grade])}${item.color ? ` · ${esc(item.color)}` : ''}${item.material ? ` · ${esc(item.material)}` : ''}</p>`,
    `<p>${esc(item.description_md.replace(/[#*_>`]/g, ''))}</p>`,
    flaws,
    meas ? `<p><b>Measurements (taken flat):</b></p><ul>${meas}</ul>` : '',
    `<p>Pre-owned, one of a kind. Ships with tracking, ${HANDLING_TEXT}.</p>`,
  ].join('');
}

export function inventoryItemBody(item: Item, imageUrls: string[]) {
  const aspects: Record<string, string[]> = { Brand: [item.brand], Department: ['Women'], Type: [CATEGORY_LABELS[item.category]] };
  if (item.size_label) aspects.Size = [item.size_label];
  if (item.color) aspects.Color = [item.color];
  if (item.material) aspects.Material = [item.material];
  return {
    availability: { shipToLocationAvailability: { quantity: 1 } },
    condition: EBAY_CONDITION[item.condition_grade],
    conditionDescription: item.condition_grade === 'new_with_tags' ? undefined : (item.flaws.map((f) => f.text).join('; ') || item.condition_notes || CONDITION_LABELS[item.condition_grade]).slice(0, 1000),
    product: {
      title: ebayTitle(item),
      description: ebayDescription(item).slice(0, 4000),
      imageUrls: imageUrls.slice(0, 12),
      aspects,
    },
  };
}

export function offerBody(item: Item, meta: Record<string, string>) {
  return {
    sku: item.sku,
    marketplaceId: 'EBAY_US',
    format: 'FIXED_PRICE',
    availableQuantity: 1,
    categoryId: meta[`category_${item.category}`] || EBAY_CATEGORY[item.category],
    listingDescription: ebayDescription(item).slice(0, 4000),
    listingPolicies: {
      fulfillmentPolicyId: meta.fulfillmentPolicyId,
      paymentPolicyId: meta.paymentPolicyId,
      returnPolicyId: meta.returnPolicyId,
    },
    merchantLocationKey: meta.merchantLocationKey,
    pricingSummary: { price: { currency: 'USD', value: ebayPrice(item) } },
  };
}
