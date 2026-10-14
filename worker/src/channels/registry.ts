// Channel orchestration: list/delist across enabled channels, retry failures, ingest external sales.

import type { Env } from '../env';
import { now } from '../env';
import type { Channel, DelistReason, ExternalSale } from './types';
import { mockChannel } from './mock';
import { ebayChannel } from './ebay';
import { getItemById, listChannelListings, listPhotos, logEvent, photoToSrc, upsertChannelListing, getSetting, setSetting } from '../db/queries';
import type { Item, Order } from '@kw/shared/types';
import { markSold } from '../services/reservations';
import { sendEmail, sellerChannelSale } from '../services/email';
import { requestRebuild } from '../services/rebuild';
import { ulid } from '../services/ids';

const ALL: Record<string, Channel> = { mock: mockChannel, ebay: ebayChannel };

export function enabledChannels(env: Env): Channel[] {
  return (env.CHANNELS || '')
    .split(',')
    .map((s) => s.trim())
    .filter((n) => n && ALL[n])
    .map((n) => ALL[n]);
}

export function getChannel(name: string): Channel | undefined {
  return ALL[name];
}

/** Create/refresh the listing for one item on one channel; never throws. */
export async function listOn(env: Env, channel: Channel, item: Item, imgBase: string): Promise<void> {
  const photos = (await listPhotos(env.DB, [item.id])).get(item.id) ?? [];
  const jpgs = photos.filter((p) => p.kind !== 'flaw').map((p) => photoToSrc(p, imgBase).jpg);
  try {
    const r = await channel.list(env, item, photos, jpgs);
    await upsertChannelListing(env.DB, { item_id: item.id, channel: channel.name, ...r, status: 'listed', last_error: null, last_synced_at: now() });
    await logEvent(env.DB, { actor: 'system', kind: 'channel_listed', item_id: item.id, payload: { channel: channel.name, url: r.listing_url } });
  } catch (e) {
    const msg = (e as Error).message;
    await upsertChannelListing(env.DB, {
      item_id: item.id, channel: channel.name, external_sku: item.sku, external_offer_id: null, external_listing_id: null,
      listing_url: null, status: 'error', last_error: msg, last_synced_at: now(),
    });
    await logEvent(env.DB, { actor: 'system', kind: 'channel_error', item_id: item.id, payload: { channel: channel.name, op: 'list', message: msg } });
  }
}

export async function listEverywhere(env: Env, item: Item, imgBase: string): Promise<void> {
  await Promise.allSettled(enabledChannels(env).map((ch) => listOn(env, ch, item, imgBase)));
}

/** End the item's listings on every channel except the one it sold on. */
export async function delistEverywhere(env: Env, item: Item, reason: DelistReason, exceptChannel?: string): Promise<void> {
  const listings = await listChannelListings(env.DB, item.id);
  await Promise.allSettled(
    listings
      .filter((l) => l.status === 'listed' && l.channel !== exceptChannel)
      .map(async (l) => {
        const ch = ALL[l.channel];
        if (!ch) return;
        try {
          await ch.delist(env, l, reason);
          await upsertChannelListing(env.DB, { ...l, status: 'ended', last_error: null, last_synced_at: now() });
          await logEvent(env.DB, { actor: 'system', kind: 'channel_delisted', item_id: item.id, payload: { channel: l.channel, reason } });
        } catch (e) {
          // Keep status 'listed' with an error so the cron retries the delist.
          await upsertChannelListing(env.DB, { ...l, last_error: `delist failed: ${(e as Error).message}`, last_synced_at: now() });
          await logEvent(env.DB, { actor: 'system', kind: 'channel_error', item_id: item.id, payload: { channel: l.channel, op: 'delist', message: (e as Error).message } });
        }
      }),
  );
}

/** Cron: retry listings in error, and delists that failed (still 'listed' but item is sold/archived). */
export async function retryFailedListings(env: Env): Promise<void> {
  const listings = await listChannelListings(env.DB);
  for (const l of listings) {
    const item = await getItemById(env.DB, l.item_id);
    if (!item) continue;
    const ch = ALL[l.channel];
    if (!ch || !enabledChannels(env).includes(ch)) continue;
    if (l.status === 'listed' && (item.status === 'sold' || item.status === 'archived') && l.last_error) {
      await delistEverywhere(env, item, item.status === 'sold' ? 'sold_other' : 'archived', item.sold_channel ?? undefined);
    } else if (l.status === 'error' && item.status === 'available') {
      await listOn(env, ch, item, imgBaseFromEnv(env));
    }
  }
}

/** Cron: pull sales from each channel and mark items sold on the site. */
export async function pollChannelSales(env: Env): Promise<void> {
  for (const ch of enabledChannels(env)) {
    const key = `${ch.name}_last_poll_at`;
    const since = Number((await getSetting(env.DB, key)) ?? 0) || now() - 7 * 86400;
    let sales: ExternalSale[] = [];
    try {
      sales = await ch.pollSales(env, since);
    } catch (e) {
      console.error(`poll ${ch.name} failed`, (e as Error).message);
      continue;
    }
    for (const sale of sales) await ingestExternalSale(env, ch.name, sale);
    await setSetting(env.DB, key, String(now() - 300)); // small overlap; orders are de-duplicated by external_id
  }
}

export async function ingestExternalSale(env: Env, channel: string, sale: ExternalSale): Promise<boolean> {
  const row = await env.DB.prepare('SELECT id FROM items WHERE sku = ?').bind(sale.external_sku).first<{ id: string }>();
  if (!row) return false;
  const exists = await env.DB.prepare('SELECT id FROM orders WHERE channel = ? AND external_id = ?').bind(channel, sale.external_order_id).first();
  if (exists) return false;
  const item = await getItemById(env.DB, row.id);
  if (!item) return false;

  const sold = await markSold(env.DB, item.id, channel);
  const order: Order = {
    id: ulid(), item_id: item.id, channel, external_id: sale.external_order_id, stripe_payment_intent: null,
    buyer_email: sale.buyer_email, buyer_name: sale.buyer_name, ship_to: sale.ship_to,
    subtotal_cents: sale.subtotal_cents, shipping_cents: sale.shipping_cents, tax_cents: sale.tax_cents, total_cents: sale.total_cents,
    status: 'paid', tracking_carrier: null, tracking_number: null, shipped_at: null, policy_version: null, created_at: sale.paid_at,
  };
  await env.DB.prepare(
    `INSERT INTO orders (id, item_id, channel, external_id, buyer_email, buyer_name, ship_to_json, subtotal_cents, shipping_cents, tax_cents, total_cents, status, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(order.id, order.item_id, order.channel, order.external_id, order.buyer_email, order.buyer_name, order.ship_to ? JSON.stringify(order.ship_to) : null,
      order.subtotal_cents, order.shipping_cents, order.tax_cents, order.total_cents, order.status, order.created_at)
    .run();
  const l = (await listChannelListings(env.DB, item.id)).find((x) => x.channel === channel);
  if (l) await upsertChannelListing(env.DB, { ...l, status: 'ended', last_error: null, last_synced_at: now() });
  await logEvent(env.DB, { actor: 'cron', kind: 'external_sale', item_id: item.id, order_id: order.id, payload: { channel, already_sold: !sold } });
  await Promise.allSettled([
    delistEverywhere(env, item, 'sold_other', channel),
    sendEmail(env, sellerChannelSale(env, item, channel, order)),
    requestRebuild(env, `sold on ${channel} ${item.sku}`),
  ]);
  return true;
}

/** The Worker's own public origin for image URLs when there is no request (cron). */
export function imgBaseFromEnv(env: Env): string {
  return (env as any).PUBLIC_API_URL || 'https://the-wardrobe-exchange-api.workers.dev';
}
