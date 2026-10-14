import { Hono } from 'hono';
import type { AppContext } from '../env';
import { now } from '../env';
import { issueToken, verifyPassword, verifyToken } from '../services/auth';
import { ulid, itemSlug, makeSku } from '../services/ids';
import {
  getItemById, listItems, listPhotos, updateItem, logEvent, listOrders, listChannelListings, photoToSrc, rowToItem, toCatalogItem,
  type ItemInput, type ItemRow, PHOTO_VARIANTS,
} from '../db/queries';
import { markSold, releaseReservation } from '../services/reservations';
import { requestRebuild } from '../services/rebuild';
import { enabledChannels, getChannel, listOn, listEverywhere, delistEverywhere, pollChannelSales } from '../channels/registry';
import { queueMockSale } from '../channels/mock';
import { ebayOAuthRoutes } from '../channels/ebay/oauth';
import { ensureSetup } from '../channels/ebay';
import { sendEmail, buyerShipped } from '../services/email';
import { expireCheckoutSession } from '../services/stripe';
import { BRAND } from '@kw/shared/brand';
import type { PhotoKind } from '@kw/shared/types';

export const adminRoutes = new Hono<AppContext>();

const LOGIN_WINDOW = 15 * 60;
const LOGIN_MAX = 5;

adminRoutes.post('/login', async (c) => {
  const ip = c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? 'local';
  const t = now();
  const attempts = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE ip = ? AND ts > ?').bind(ip, t - LOGIN_WINDOW).first<{ n: number }>();
  if ((attempts?.n ?? 0) >= LOGIN_MAX) return c.json({ error: 'rate_limited', message: 'Too many attempts. Try again in 15 minutes.' }, 429);

  const body = await c.req.json().catch(() => ({})) as { password?: string };
  const ok = !!body.password && !!c.env.ADMIN_PASSWORD_HASH && (await verifyPassword(body.password, c.env.ADMIN_PASSWORD_HASH));
  if (!ok) {
    await c.env.DB.prepare('INSERT INTO login_attempts (ip, ts) VALUES (?,?)').bind(ip, t).run();
    return c.json({ error: 'invalid_credentials' }, 401);
  }
  await c.env.DB.prepare('DELETE FROM login_attempts WHERE ip = ?').bind(ip).run();
  const { token, exp } = await issueToken(c.env.SESSION_SECRET);
  await logEvent(c.env.DB, { actor: 'admin', kind: 'login', payload: { ip } });
  return c.json({ token, expires_at: exp });
});

// Everything below requires a valid bearer token.
adminRoutes.use('*', async (c, next) => {
  const path = new URL(c.req.url).pathname;
  if (path.endsWith('/login') || path.includes('/channels/ebay/oauth/callback')) return next();
  const auth = c.req.header('authorization') ?? '';
  const session = await verifyToken(c.env.SESSION_SECRET, auth.startsWith('Bearer ') ? auth.slice(7) : undefined);
  if (!session) return c.json({ error: 'unauthorized' }, 401);
  c.set('adminSession', session);
  return next();
});

adminRoutes.get('/me', (c) => c.json({ ok: true, exp: c.get('adminSession')?.exp, channels: enabledChannels(c.env).map((ch) => ch.name), brand: BRAND.name }));

// ---------- items ----------

adminRoutes.get('/items', async (c) => {
  const status = c.req.query('status');
  const items = await listItems(c.env.DB, status ? [status as any] : undefined);
  const photos = await listPhotos(c.env.DB, items.map((i) => i.id), false);
  const listings = await listChannelListings(c.env.DB);
  const origin = new URL(c.req.url).origin;
  return c.json(
    items.map((i) => ({
      ...toCatalogItem(i, photos.get(i.id) ?? [], origin, c.env.PUBLIC_SITE_URL),
      reserved_until: i.reserved_until,
      channels: listings.filter((l) => l.item_id === i.id),
    })),
  );
});

adminRoutes.post('/items', async (c) => {
  const input = (await c.req.json().catch(() => ({}))) as ItemInput;
  const id = ulid();
  const t = now();
  const sku = input.sku?.trim() || makeSku(BRAND.short.slice(0, 2));
  const slug = itemSlug(input.brand ?? '', input.title ?? '', input.size_label ?? '', id);
  await c.env.DB.prepare('INSERT INTO items (id, slug, sku, status, created_at, updated_at) VALUES (?,?,?,?,?,?)').bind(id, slug, sku, 'draft', t, t).run();
  await updateItem(c.env.DB, id, { ...input, sku: undefined });
  await logEvent(c.env.DB, { actor: 'admin', kind: 'item_created', item_id: id });
  return c.json(await getItemById(c.env.DB, id), 201);
});

adminRoutes.get('/items/:id', async (c) => {
  const item = await getItemById(c.env.DB, c.req.param('id'));
  if (!item) return c.json({ error: 'not_found' }, 404);
  const photos = (await listPhotos(c.env.DB, [item.id], false)).get(item.id) ?? [];
  const origin = new URL(c.req.url).origin;
  return c.json({ ...toCatalogItem(item, photos, origin, c.env.PUBLIC_SITE_URL), reserved_until: item.reserved_until, channels: await listChannelListings(c.env.DB, item.id) });
});

adminRoutes.patch('/items/:id', async (c) => {
  const id = c.req.param('id');
  const item = await getItemById(c.env.DB, id);
  if (!item) return c.json({ error: 'not_found' }, 404);
  const input = (await c.req.json().catch(() => ({}))) as ItemInput;
  await updateItem(c.env.DB, id, input);
  // Keep the slug in sync while still a draft (published URLs must not change).
  if (item.status === 'draft' && (input.brand !== undefined || input.title !== undefined || input.size_label !== undefined)) {
    const fresh = (await getItemById(c.env.DB, id))!;
    await c.env.DB.prepare('UPDATE items SET slug = ? WHERE id = ?').bind(itemSlug(fresh.brand, fresh.title, fresh.size_label, id), id).run();
  }
  const updated = (await getItemById(c.env.DB, id))!;
  if (updated.status === 'available') {
    c.executionCtx.waitUntil(Promise.all([
      requestRebuild(c.env, `edit ${updated.sku}`),
      ...(await listChannelListings(c.env.DB, id)).filter((l) => l.status === 'listed').map((l) => getChannel(l.channel)?.update(c.env, updated, l).catch(() => {})),
    ]));
  }
  await logEvent(c.env.DB, { actor: 'admin', kind: 'item_updated', item_id: id, payload: Object.keys(input) });
  return c.json(updated);
});

adminRoutes.post('/items/:id/publish', async (c) => {
  const id = c.req.param('id');
  const item = await getItemById(c.env.DB, id);
  if (!item) return c.json({ error: 'not_found' }, 404);
  if (item.status === 'sold') return c.json({ error: 'already_sold' }, 409);
  const photos = (await listPhotos(c.env.DB, [id])).get(id) ?? [];
  const problems: string[] = [];
  if (!item.title) problems.push('title');
  if (!item.brand) problems.push('brand');
  if (!item.size_label) problems.push('size');
  if (item.price_cents < 100) problems.push('price');
  if (!photos.some((p) => p.kind === 'actual')) problems.push('at least one "Actual item" photo');
  if (problems.length) return c.json({ error: 'incomplete', missing: problems }, 422);

  await c.env.DB.prepare(`UPDATE items SET status = 'available', published_at = COALESCE(published_at, ?), updated_at = ? WHERE id = ?`).bind(now(), now(), id).run();
  await logEvent(c.env.DB, { actor: 'admin', kind: 'item_published', item_id: id });
  const fresh = (await getItemById(c.env.DB, id))!;
  c.executionCtx.waitUntil(Promise.all([requestRebuild(c.env, `publish ${fresh.sku}`), listEverywhere(c.env, fresh, new URL(c.req.url).origin)]));
  return c.json(fresh);
});

adminRoutes.post('/items/:id/unpublish', async (c) => {
  const id = c.req.param('id');
  const item = await getItemById(c.env.DB, id);
  if (!item) return c.json({ error: 'not_found' }, 404);
  if (item.status !== 'available') return c.json({ error: 'not_available' }, 409);
  await c.env.DB.prepare(`UPDATE items SET status = 'draft', updated_at = ? WHERE id = ?`).bind(now(), id).run();
  await logEvent(c.env.DB, { actor: 'admin', kind: 'item_unpublished', item_id: id });
  c.executionCtx.waitUntil(Promise.all([delistEverywhere(c.env, item, 'archived'), requestRebuild(c.env, `unpublish ${item.sku}`)]));
  return c.json(await getItemById(c.env.DB, id));
});

adminRoutes.post('/items/:id/mark-sold', async (c) => {
  const id = c.req.param('id');
  const item = await getItemById(c.env.DB, id);
  if (!item) return c.json({ error: 'not_found' }, 404);
  const body = (await c.req.json().catch(() => ({}))) as { channel?: string; note?: string; total_cents?: number };
  const channel = body.channel?.trim() || 'manual';
  // Cancel any live Stripe session on this item so the buyer can't complete it.
  const held = await c.env.DB.prepare(`SELECT id, stripe_session_id FROM reservations WHERE item_id = ? AND status = 'held'`).bind(id).all<{ id: string; stripe_session_id: string | null }>();
  for (const r of held.results) if (r.stripe_session_id) await expireCheckoutSession(c.env, r.stripe_session_id);
  const ok = await markSold(c.env.DB, id, channel);
  if (!ok) return c.json({ error: 'already_sold' }, 409);
  await c.env.DB.prepare(
    `INSERT INTO orders (id, item_id, channel, external_id, subtotal_cents, total_cents, status, notes, created_at) VALUES (?,?,?,?,?,?,?,?,?)`,
  )
    .bind(ulid(), id, channel, `manual-${id}-${now()}`, body.total_cents ?? item.price_cents, body.total_cents ?? item.price_cents, 'paid', body.note ?? null, now())
    .run();
  await logEvent(c.env.DB, { actor: 'admin', kind: 'marked_sold', item_id: id, payload: { channel, note: body.note } });
  c.executionCtx.waitUntil(Promise.all([delistEverywhere(c.env, item, 'sold_other', channel), requestRebuild(c.env, `sold ${item.sku} on ${channel}`)]));
  return c.json(await getItemById(c.env.DB, id));
});

adminRoutes.post('/items/:id/archive', async (c) => {
  const id = c.req.param('id');
  const item = await getItemById(c.env.DB, id);
  if (!item) return c.json({ error: 'not_found' }, 404);
  await c.env.DB.prepare(`UPDATE items SET status = 'archived', updated_at = ? WHERE id = ?`).bind(now(), id).run();
  await logEvent(c.env.DB, { actor: 'admin', kind: 'item_archived', item_id: id });
  c.executionCtx.waitUntil(Promise.all([delistEverywhere(c.env, item, 'archived'), requestRebuild(c.env, `archive ${item.sku}`)]));
  return c.json(await getItemById(c.env.DB, id));
});

adminRoutes.post('/items/:id/release-hold', async (c) => {
  const id = c.req.param('id');
  const row = await c.env.DB.prepare('SELECT reservation_id FROM items WHERE id = ?').bind(id).first<{ reservation_id: string | null }>();
  if (!row?.reservation_id) return c.json({ error: 'no_hold' }, 409);
  const held = await c.env.DB.prepare('SELECT stripe_session_id FROM reservations WHERE id = ?').bind(row.reservation_id).first<{ stripe_session_id: string | null }>();
  if (held?.stripe_session_id) await expireCheckoutSession(c.env, held.stripe_session_id);
  await releaseReservation(c.env.DB, row.reservation_id);
  return c.json(await getItemById(c.env.DB, id));
});

// ---------- photos ----------

adminRoutes.post('/photos', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { item_id?: string; kind?: PhotoKind; width?: number; height?: number; alt?: string };
  if (!body.item_id || !body.kind) return c.json({ error: 'bad_request' }, 400);
  const item = await getItemById(c.env.DB, body.item_id);
  if (!item) return c.json({ error: 'not_found' }, 404);
  const id = ulid();
  const base = `items/${item.id}/${id}`;
  const count = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM photos WHERE item_id = ?').bind(item.id).first<{ n: number }>();
  await c.env.DB.prepare('INSERT INTO photos (id, item_id, kind, sort, r2_key_base, width, height, alt, is_cover, ready, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .bind(id, item.id, body.kind, count?.n ?? 0, base, body.width ?? 0, body.height ?? 0, body.alt ?? `${item.brand} ${item.title}`, 0, 0, now())
    .run();
  return c.json({ id, r2_key_base: base, variants: Object.values(PHOTO_VARIANTS) }, 201);
});

// Raw bytes in the body; variant is one of _1600.webp _1000.webp _480.webp _1600.jpg
adminRoutes.put('/photos/:id/variant/:variant', async (c) => {
  const { id, variant } = c.req.param();
  if (!Object.values(PHOTO_VARIANTS).includes(variant as any)) return c.json({ error: 'bad_variant' }, 400);
  const p = await c.env.DB.prepare('SELECT r2_key_base FROM photos WHERE id = ?').bind(id).first<{ r2_key_base: string }>();
  if (!p) return c.json({ error: 'not_found' }, 404);
  const contentType = variant.endsWith('.jpg') ? 'image/jpeg' : 'image/webp';
  await c.env.PHOTOS.put(p.r2_key_base + variant, c.req.raw.body, { httpMetadata: { contentType, cacheControl: 'public, max-age=31536000, immutable' } });
  return c.json({ ok: true });
});

adminRoutes.post('/photos/:id/complete', async (c) => {
  const id = c.req.param('id');
  const p = await c.env.DB.prepare('SELECT item_id FROM photos WHERE id = ?').bind(id).first<{ item_id: string }>();
  if (!p) return c.json({ error: 'not_found' }, 404);
  await c.env.DB.prepare('UPDATE photos SET ready = 1 WHERE id = ?').bind(id).run();
  const cover = await c.env.DB.prepare('SELECT id FROM photos WHERE item_id = ? AND is_cover = 1').bind(p.item_id).first();
  if (!cover) await c.env.DB.prepare('UPDATE photos SET is_cover = 1 WHERE id = ?').bind(id).run();
  return c.json({ ok: true });
});

adminRoutes.patch('/photos/:id', async (c) => {
  const id = c.req.param('id');
  const body = (await c.req.json().catch(() => ({}))) as { kind?: PhotoKind; alt?: string; is_cover?: boolean };
  const p = await c.env.DB.prepare('SELECT item_id FROM photos WHERE id = ?').bind(id).first<{ item_id: string }>();
  if (!p) return c.json({ error: 'not_found' }, 404);
  if (body.kind) await c.env.DB.prepare('UPDATE photos SET kind = ? WHERE id = ?').bind(body.kind, id).run();
  if (body.alt !== undefined) await c.env.DB.prepare('UPDATE photos SET alt = ? WHERE id = ?').bind(body.alt, id).run();
  if (body.is_cover) {
    await c.env.DB.prepare('UPDATE photos SET is_cover = 0 WHERE item_id = ?').bind(p.item_id).run();
    await c.env.DB.prepare('UPDATE photos SET is_cover = 1 WHERE id = ?').bind(id).run();
  }
  return c.json({ ok: true });
});

adminRoutes.patch('/photos/reorder', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { ids?: string[] };
  if (!body.ids?.length) return c.json({ error: 'bad_request' }, 400);
  await c.env.DB.batch(body.ids.map((id, i) => c.env.DB.prepare('UPDATE photos SET sort = ? WHERE id = ?').bind(i, id)));
  return c.json({ ok: true });
});

adminRoutes.delete('/photos/:id', async (c) => {
  const id = c.req.param('id');
  const p = await c.env.DB.prepare('SELECT r2_key_base FROM photos WHERE id = ?').bind(id).first<{ r2_key_base: string }>();
  if (!p) return c.json({ error: 'not_found' }, 404);
  await Promise.all(Object.values(PHOTO_VARIANTS).map((v) => c.env.PHOTOS.delete(p.r2_key_base + v)));
  await c.env.DB.prepare('DELETE FROM photos WHERE id = ?').bind(id).run();
  return c.json({ ok: true });
});

// ---------- orders ----------

adminRoutes.get('/orders', async (c) => {
  const orders = await listOrders(c.env.DB, c.req.query('status') || undefined);
  const ids = [...new Set(orders.map((o) => o.item_id))];
  const items = new Map<string, ItemRow>();
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    const { results } = await c.env.DB.prepare(`SELECT * FROM items WHERE id IN (${chunk.map(() => '?').join(',')})`).bind(...chunk).all<ItemRow>();
    for (const r of results) items.set(r.id, r);
  }
  return c.json(orders.map((o) => ({ ...o, item: items.has(o.item_id) ? rowToItem(items.get(o.item_id)!) : null })));
});

adminRoutes.post('/orders/:id/ship', async (c) => {
  const id = c.req.param('id');
  const body = (await c.req.json().catch(() => ({}))) as { carrier?: string; tracking?: string };
  if (!body.tracking) return c.json({ error: 'bad_request', message: 'tracking required' }, 400);
  await c.env.DB.prepare(`UPDATE orders SET status = 'shipped', tracking_carrier = ?, tracking_number = ?, shipped_at = ? WHERE id = ? AND status = 'paid'`)
    .bind(body.carrier ?? 'USPS', body.tracking, now(), id)
    .run();
  const orders = await listOrders(c.env.DB);
  const order = orders.find((o) => o.id === id);
  if (!order) return c.json({ error: 'not_found' }, 404);
  const item = await getItemById(c.env.DB, order.item_id);
  await logEvent(c.env.DB, { actor: 'admin', kind: 'order_shipped', item_id: order.item_id, order_id: id, payload: { tracking: body.tracking } });
  if (item && order.channel === 'site' && order.buyer_email) c.executionCtx.waitUntil(sendEmail(c.env, buyerShipped(c.env, item, order)));
  return c.json(order);
});

adminRoutes.post('/orders/:id/note', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { note?: string };
  await c.env.DB.prepare('UPDATE orders SET notes = ? WHERE id = ?').bind(body.note ?? null, c.req.param('id')).run();
  return c.json({ ok: true });
});

// ---------- channels ----------

adminRoutes.get('/channels', async (c) => {
  const out = [];
  for (const ch of enabledChannels(c.env)) out.push({ name: ch.name, ...(await ch.healthcheck(c.env)) });
  return c.json({ channels: out, listings: await listChannelListings(c.env.DB) });
});

adminRoutes.post('/channels/:name/sync/:item_id', async (c) => {
  const ch = getChannel(c.req.param('name'));
  const item = await getItemById(c.env.DB, c.req.param('item_id'));
  if (!ch || !item) return c.json({ error: 'not_found' }, 404);
  if (item.status !== 'available') return c.json({ error: 'not_available' }, 409);
  await listOn(c.env, ch, item, new URL(c.req.url).origin);
  return c.json({ listings: await listChannelListings(c.env.DB, item.id) });
});

adminRoutes.post('/channels/poll', async (c) => {
  await pollChannelSales(c.env);
  return c.json({ ok: true });
});

adminRoutes.post('/channels/mock/simulate-sale/:item_id', async (c) => {
  const item = await getItemById(c.env.DB, c.req.param('item_id'));
  if (!item) return c.json({ error: 'not_found' }, 404);
  await queueMockSale(c.env, item.sku, item.price_cents);
  await pollChannelSales(c.env);
  return c.json(await getItemById(c.env.DB, item.id));
});

adminRoutes.post('/channels/ebay/setup', async (c) => {
  try {
    return c.json(await ensureSetup(c.env));
  } catch (e) {
    return c.json({ error: 'setup_failed', message: (e as Error).message }, 502);
  }
});

adminRoutes.route('/channels/ebay/oauth', ebayOAuthRoutes);

// ---------- misc ----------

adminRoutes.get('/events', async (c) => {
  const itemId = c.req.query('item_id');
  const stmt = itemId
    ? c.env.DB.prepare('SELECT * FROM events WHERE item_id = ? ORDER BY ts DESC LIMIT 200').bind(itemId)
    : c.env.DB.prepare('SELECT * FROM events ORDER BY ts DESC LIMIT 200');
  const { results } = await stmt.all();
  return c.json(results);
});

adminRoutes.post('/rebuild', async (c) => {
  await requestRebuild(c.env, 'manual');
  return c.json({ ok: true });
});

adminRoutes.get('/photo-src/:id', async (c) => {
  const p = await c.env.DB.prepare('SELECT * FROM photos WHERE id = ?').bind(c.req.param('id')).first<any>();
  if (!p) return c.json({ error: 'not_found' }, 404);
  return c.json(photoToSrc({ ...p, is_cover: !!p.is_cover }, new URL(c.req.url).origin));
});
