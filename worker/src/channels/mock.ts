// Development stand-in for a marketplace: records listings in D1 and lets the admin
// simulate an external sale (POST /admin/channels/mock/simulate-sale/:item_id).

import type { Channel, ExternalSale, ListResult } from './types';
import type { Env } from '../env';
import { getSetting, setSetting } from '../db/queries';

const PENDING_KEY = 'mock_pending_sales';

export const mockChannel: Channel = {
  name: 'mock',
  async list(_env, item): Promise<ListResult> {
    const id = `MOCK-${item.sku}`;
    return { external_sku: item.sku, external_offer_id: id, external_listing_id: id, listing_url: `https://example.invalid/listing/${item.sku}` };
  },
  async update() {},
  async delist() {},
  async pollSales(env): Promise<ExternalSale[]> {
    const raw = await getSetting(env.DB, PENDING_KEY);
    if (!raw) return [];
    await setSetting(env.DB, PENDING_KEY, '');
    return JSON.parse(raw) as ExternalSale[];
  },
  async healthcheck() {
    return { ok: true, detail: 'mock channel (no external calls)' };
  },
};

/** Queue a fake marketplace sale; the cron (or an admin "poll now") will process it. */
export async function queueMockSale(env: Env, sku: string, priceCents: number): Promise<void> {
  const raw = await getSetting(env.DB, PENDING_KEY);
  const arr: ExternalSale[] = raw ? JSON.parse(raw) : [];
  arr.push({
    external_order_id: `MOCKORDER-${Date.now()}`,
    external_sku: sku,
    buyer_name: 'Mock Buyer',
    buyer_email: 'mock-buyer@example.com',
    ship_to: { name: 'Mock Buyer', line1: '1 Test St', city: 'Salt Lake City', state: 'UT', postal_code: '84101', country: 'US' },
    subtotal_cents: priceCents,
    shipping_cents: 0,
    tax_cents: 0,
    total_cents: priceCents,
    paid_at: Math.floor(Date.now() / 1000),
  });
  await setSetting(env.DB, PENDING_KEY, JSON.stringify(arr));
}
