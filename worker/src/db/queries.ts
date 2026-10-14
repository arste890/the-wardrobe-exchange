// Typed D1 helpers. Rows are stored flat; JSON columns are parsed here.

import type {
  Item,
  Photo,
  PhotoSrc,
  CatalogItem,
  Order,
  ChannelListing,
  Category,
  ShippingClass,
  ConditionGrade,
  ItemStatus,
} from '@kw/shared/types';
import { shippingCents } from '@kw/shared/shipping';
import { ulid } from '../services/ids';
import { now } from '../env';

export type ItemRow = Omit<Item, 'flaws' | 'measurements'> & {
  flaws_json: string;
  measurements_json: string;
  reservation_id: string | null;
};

export function rowToItem(r: ItemRow): Item {
  const { flaws_json, measurements_json, reservation_id: _rid, ...rest } = r;
  return {
    ...rest,
    flaws: safeJson(flaws_json, []),
    measurements: safeJson(measurements_json, {}),
  };
}

export function safeJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

export const PHOTO_VARIANTS = {
  large: '_1600.webp',
  medium: '_1000.webp',
  small: '_480.webp',
  jpg: '_1600.jpg',
} as const;

export function photoToSrc(p: Photo, imgBase: string): PhotoSrc {
  const base = `${imgBase}/img/${p.r2_key_base}`;
  return {
    id: p.id,
    kind: p.kind,
    alt: p.alt,
    width: p.width,
    height: p.height,
    is_cover: !!p.is_cover,
    large: base + PHOTO_VARIANTS.large,
    medium: base + PHOTO_VARIANTS.medium,
    small: base + PHOTO_VARIANTS.small,
    jpg: base + PHOTO_VARIANTS.jpg,
  };
}

export async function getItemById(db: D1Database, id: string): Promise<Item | null> {
  const r = await db.prepare('SELECT * FROM items WHERE id = ?').bind(id).first<ItemRow>();
  return r ? rowToItem(r) : null;
}

export async function getItemBySlug(db: D1Database, slug: string): Promise<Item | null> {
  const r = await db.prepare('SELECT * FROM items WHERE slug = ?').bind(slug).first<ItemRow>();
  return r ? rowToItem(r) : null;
}

export async function listItems(db: D1Database, statuses?: ItemStatus[]): Promise<Item[]> {
  let sql = 'SELECT * FROM items';
  const binds: string[] = [];
  if (statuses?.length) {
    sql += ` WHERE status IN (${statuses.map(() => '?').join(',')})`;
    binds.push(...statuses);
  }
  sql += ' ORDER BY COALESCE(published_at, created_at) DESC';
  const { results } = await db.prepare(sql).bind(...binds).all<ItemRow>();
  return results.map(rowToItem);
}

export async function listPhotos(db: D1Database, itemIds: string[], readyOnly = true): Promise<Map<string, Photo[]>> {
  const map = new Map<string, Photo[]>();
  if (!itemIds.length) return map;
  // D1 bind limit is generous, but chunk to be safe.
  for (let i = 0; i < itemIds.length; i += 90) {
    const chunk = itemIds.slice(i, i + 90);
    const { results } = await db
      .prepare(
        `SELECT * FROM photos WHERE item_id IN (${chunk.map(() => '?').join(',')})${readyOnly ? ' AND ready = 1' : ''} ORDER BY sort ASC, created_at ASC`,
      )
      .bind(...chunk)
      .all<Omit<Photo, 'is_cover'> & { is_cover: number; ready: number }>();
    for (const p of results) {
      const arr = map.get(p.item_id) ?? [];
      const { ready: _ready, ...rest } = p;
      arr.push({ ...rest, is_cover: !!p.is_cover });
      map.set(p.item_id, arr);
    }
  }
  return map;
}

export function toCatalogItem(item: Item, photos: Photo[], imgBase: string, siteUrl: string): CatalogItem {
  const srcs = photos.map((p) => photoToSrc(p, imgBase));
  // Cover preference: explicit cover → first studio → first actual.
  const cover = srcs.find((p) => p.is_cover) ?? srcs.find((p) => p.kind === 'studio') ?? srcs.find((p) => p.kind === 'actual') ?? null;
  const { reserved_until: _ru, ...rest } = item;
  return {
    ...rest,
    photos: srcs,
    cover,
    shipping_cents: shippingCents(item.shipping_class),
    url: `${siteUrl.replace(/\/$/, '')}/item/${item.slug}`,
  };
}

export interface ItemInput {
  title?: string;
  brand?: string;
  category?: Category;
  subcategory?: string | null;
  size_label?: string;
  size_system?: string | null;
  color?: string | null;
  material?: string | null;
  condition_grade?: ConditionGrade;
  condition_notes?: string | null;
  flaws?: { text: string; photo_id?: string }[];
  measurements?: Record<string, number | undefined>;
  description_md?: string;
  price_cents?: number;
  original_price_cents?: number | null;
  shipping_class?: ShippingClass;
  tax_code?: string;
  sku?: string;
}

const UPDATABLE: (keyof ItemInput)[] = [
  'title', 'brand', 'category', 'subcategory', 'size_label', 'size_system', 'color', 'material',
  'condition_grade', 'condition_notes', 'description_md', 'price_cents', 'original_price_cents',
  'shipping_class', 'tax_code', 'sku',
];

export async function updateItem(db: D1Database, id: string, input: ItemInput): Promise<void> {
  const sets: string[] = [];
  const binds: unknown[] = [];
  for (const k of UPDATABLE) {
    if (input[k] !== undefined) {
      sets.push(`${k} = ?`);
      binds.push(input[k]);
    }
  }
  if (input.flaws !== undefined) {
    sets.push('flaws_json = ?');
    binds.push(JSON.stringify(input.flaws));
  }
  if (input.measurements !== undefined) {
    const clean: Record<string, number> = {};
    for (const [k, v] of Object.entries(input.measurements)) if (typeof v === 'number' && !Number.isNaN(v)) clean[k] = v;
    sets.push('measurements_json = ?');
    binds.push(JSON.stringify(clean));
  }
  if (!sets.length) return;
  sets.push('updated_at = ?');
  binds.push(now(), id);
  await db.prepare(`UPDATE items SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
}

export async function logEvent(
  db: D1Database,
  e: { actor: 'admin' | 'webhook' | 'cron' | 'buyer' | 'system'; kind: string; item_id?: string | null; order_id?: string | null; payload?: unknown },
): Promise<void> {
  await db
    .prepare('INSERT INTO events (id, ts, actor, kind, item_id, order_id, payload_json) VALUES (?,?,?,?,?,?,?)')
    .bind(ulid(), now(), e.actor, e.kind, e.item_id ?? null, e.order_id ?? null, e.payload ? JSON.stringify(e.payload) : null)
    .run();
}

export type OrderRow = Omit<Order, 'ship_to'> & { ship_to_json: string | null; notes: string | null };

export function rowToOrder(r: OrderRow): Order & { notes: string | null } {
  const { ship_to_json, ...rest } = r;
  return { ...rest, ship_to: safeJson(ship_to_json, null) };
}

export async function listOrders(db: D1Database, status?: string): Promise<(Order & { notes: string | null })[]> {
  const sql = status ? 'SELECT * FROM orders WHERE status = ? ORDER BY created_at DESC' : 'SELECT * FROM orders ORDER BY created_at DESC';
  const stmt = status ? db.prepare(sql).bind(status) : db.prepare(sql);
  const { results } = await stmt.all<OrderRow>();
  return results.map(rowToOrder);
}

export async function listChannelListings(db: D1Database, itemId?: string): Promise<ChannelListing[]> {
  const stmt = itemId
    ? db.prepare('SELECT * FROM channel_listings WHERE item_id = ?').bind(itemId)
    : db.prepare('SELECT * FROM channel_listings');
  const { results } = await stmt.all<ChannelListing>();
  return results;
}

export async function upsertChannelListing(db: D1Database, l: ChannelListing): Promise<void> {
  await db
    .prepare(
      `INSERT INTO channel_listings (item_id, channel, external_sku, external_offer_id, external_listing_id, listing_url, status, last_error, last_synced_at)
       VALUES (?,?,?,?,?,?,?,?,?)
       ON CONFLICT(item_id, channel) DO UPDATE SET external_sku=excluded.external_sku, external_offer_id=excluded.external_offer_id,
         external_listing_id=excluded.external_listing_id, listing_url=excluded.listing_url, status=excluded.status,
         last_error=excluded.last_error, last_synced_at=excluded.last_synced_at`,
    )
    .bind(l.item_id, l.channel, l.external_sku, l.external_offer_id, l.external_listing_id, l.listing_url, l.status, l.last_error, l.last_synced_at)
    .run();
}

export async function getSetting(db: D1Database, key: string): Promise<string | null> {
  const r = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
  return r?.value ?? null;
}

export async function setSetting(db: D1Database, key: string, value: string): Promise<void> {
  await db.prepare('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(key, value).run();
}
