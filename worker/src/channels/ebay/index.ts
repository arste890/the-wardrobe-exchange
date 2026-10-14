// eBay channel adapter: Inventory API (list/delist) + Fulfillment API (sales in).

import type { Channel, ExternalSale, ListResult } from '../types';
import type { Env } from '../../env';
import { ebayFetch, ebayHosts, getMeta, setMeta } from './client';
import { inventoryItemBody, offerBody } from './mapping';
import { BRAND } from '@kw/shared/brand';
import { HANDLING } from '@kw/shared/shipping';

export const ebayChannel: Channel = {
  name: 'ebay',

  async list(env, item, _photos, jpgUrls): Promise<ListResult> {
    const meta = await ensureSetup(env);
    // 1) inventory item (idempotent PUT by SKU)
    await ebayFetch(env, 'PUT', `/sell/inventory/v1/inventory_item/${encodeURIComponent(item.sku)}`, inventoryItemBody(item, jpgUrls));
    // 2) offer: reuse an existing one for this SKU if present
    const existing = await ebayFetch<{ offers?: { offerId: string; listing?: { listingId: string } }[] }>(
      env, 'GET', `/sell/inventory/v1/offer?sku=${encodeURIComponent(item.sku)}&marketplace_id=EBAY_US`,
    ).catch(() => ({ offers: [] }));
    let offerId = existing.offers?.[0]?.offerId;
    const body = offerBody(item, meta);
    if (offerId) {
      await ebayFetch(env, 'PUT', `/sell/inventory/v1/offer/${offerId}`, body);
    } else {
      const created = await ebayFetch<{ offerId: string }>(env, 'POST', '/sell/inventory/v1/offer', body);
      offerId = created.offerId;
    }
    // 3) publish
    const pub = await ebayFetch<{ listingId: string }>(env, 'POST', `/sell/inventory/v1/offer/${offerId}/publish`, {});
    return {
      external_sku: item.sku,
      external_offer_id: offerId!,
      external_listing_id: pub.listingId,
      listing_url: `${ebayHosts(env).web}/itm/${pub.listingId}`,
    };
  },

  async update(env, item, listing): Promise<void> {
    if (!listing.external_offer_id) return;
    const meta = await getMeta(env);
    await ebayFetch(env, 'PUT', `/sell/inventory/v1/offer/${listing.external_offer_id}`, offerBody(item, meta));
  },

  async delist(env, listing): Promise<void> {
    if (!listing.external_offer_id) return;
    try {
      await ebayFetch(env, 'POST', `/sell/inventory/v1/offer/${listing.external_offer_id}/withdraw`, {});
    } catch (e) {
      // Fallback: zero the quantity so the listing ends.
      if (listing.external_sku) {
        await ebayFetch(env, 'POST', '/sell/inventory/v1/bulk_update_price_quantity', {
          requests: [{ sku: listing.external_sku, shipToLocationAvailability: { quantity: 0 } }],
        });
      } else throw e;
    }
  },

  async pollSales(env, sinceUnix): Promise<ExternalSale[]> {
    const since = new Date(sinceUnix * 1000).toISOString();
    const res = await ebayFetch<{ orders?: any[] }>(
      env, 'GET', `/sell/fulfillment/v1/order?filter=creationdate:%5B${since}..%5D&limit=50`,
    );
    const out: ExternalSale[] = [];
    for (const o of res.orders ?? []) {
      if (o.orderPaymentStatus && o.orderPaymentStatus !== 'PAID' && o.orderPaymentStatus !== 'FULLY_REFUNDED') continue;
      const addr = o.fulfillmentStartInstructions?.[0]?.shippingStep?.shipTo;
      const contact = addr?.contactAddress;
      for (const li of o.lineItems ?? []) {
        out.push({
          external_order_id: o.orderId,
          external_sku: li.sku,
          buyer_name: addr?.fullName ?? o.buyer?.username ?? null,
          buyer_email: addr?.email ?? null,
          ship_to: contact
            ? { name: addr.fullName ?? '', line1: contact.addressLine1 ?? '', line2: contact.addressLine2 ?? null, city: contact.city ?? '', state: contact.stateOrProvince ?? '', postal_code: contact.postalCode ?? '', country: contact.countryCode ?? 'US' }
            : null,
          subtotal_cents: toCents(li.lineItemCost?.value),
          shipping_cents: toCents(li.deliveryCost?.shippingCost?.value),
          tax_cents: toCents(o.pricingSummary?.tax?.value),
          total_cents: toCents(o.pricingSummary?.total?.value),
          paid_at: Math.floor(Date.parse(o.creationDate) / 1000),
        });
      }
    }
    return out;
  },

  async healthcheck(env) {
    if (!env.EBAY_CLIENT_ID) return { ok: false, detail: 'EBAY_CLIENT_ID not set' };
    try {
      const meta = await getMeta(env);
      await ebayFetch(env, 'GET', '/sell/account/v1/privilege');
      const missing = ['fulfillmentPolicyId', 'paymentPolicyId', 'returnPolicyId', 'merchantLocationKey'].filter((k) => !meta[k]);
      return { ok: missing.length === 0, detail: missing.length ? `connected; missing setup: ${missing.join(', ')}` : `connected (${env.EBAY_ENV ?? 'sandbox'})` };
    } catch (e) {
      return { ok: false, detail: (e as Error).message };
    }
  },
};

function toCents(v: string | number | undefined): number {
  return v === undefined || v === null ? 0 : Math.round(Number(v) * 100);
}

/**
 * First-run setup: opt in to business policies, create the three policies and an
 * inventory location if they don't exist, and remember their ids.
 */
export async function ensureSetup(env: Env): Promise<Record<string, string>> {
  const meta = await getMeta(env);
  if (meta.fulfillmentPolicyId && meta.paymentPolicyId && meta.returnPolicyId && meta.merchantLocationKey) return meta;

  await ebayFetch(env, 'POST', '/sell/account/v1/program/opt_in', { programType: 'SELLING_POLICY_MANAGEMENT' }).catch(() => {});

  const patch: Record<string, string> = {};
  if (!meta.fulfillmentPolicyId) {
    const r = await ebayFetch<{ fulfillmentPolicyId: string }>(env, 'POST', '/sell/account/v1/fulfillment_policy', {
      name: `${BRAND.short} flat US`,
      marketplaceId: 'EBAY_US',
      categoryTypes: [{ name: 'ALL_EXCLUDING_MOTORS_VEHICLES' }],
      handlingTime: { unit: 'DAY', value: HANDLING.max },
      shippingOptions: [
        {
          optionType: 'DOMESTIC',
          costType: 'FLAT_RATE',
          shippingServices: [{ shippingServiceCode: 'USPSGroundAdvantage', shippingCost: { currency: 'USD', value: '12.00' }, sortOrder: 1 }],
        },
      ],
    });
    patch.fulfillmentPolicyId = r.fulfillmentPolicyId;
  }
  if (!meta.paymentPolicyId) {
    const r = await ebayFetch<{ paymentPolicyId: string }>(env, 'POST', '/sell/account/v1/payment_policy', {
      name: `${BRAND.short} managed payments`,
      marketplaceId: 'EBAY_US',
      categoryTypes: [{ name: 'ALL_EXCLUDING_MOTORS_VEHICLES' }],
      immediatePay: true,
    });
    patch.paymentPolicyId = r.paymentPolicyId;
  }
  if (!meta.returnPolicyId) {
    const r = await ebayFetch<{ returnPolicyId: string }>(env, 'POST', '/sell/account/v1/return_policy', {
      name: `${BRAND.short} no returns`,
      marketplaceId: 'EBAY_US',
      categoryTypes: [{ name: 'ALL_EXCLUDING_MOTORS_VEHICLES' }],
      returnsAccepted: false,
    });
    patch.returnPolicyId = r.returnPolicyId;
  }
  if (!meta.merchantLocationKey) {
    const key = `${BRAND.short.toLowerCase()}-home`;
    await ebayFetch(env, 'POST', `/sell/inventory/v1/location/${key}`, {
      location: { address: { city: BRAND.seller.city, stateOrProvince: BRAND.seller.stateCode, country: 'US' } },
      name: `${BRAND.name} ship-from`,
      merchantLocationStatus: 'ENABLED',
      locationTypes: ['WAREHOUSE'],
    }).catch((e) => {
      if (!String(e.message).includes('25803')) throw e; // 25803 = already exists
    });
    patch.merchantLocationKey = key;
  }
  await setMeta(env, patch);
  return { ...meta, ...patch };
}
