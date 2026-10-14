import { Hono } from 'hono';
import type { AppContext } from '../env';
import { getItemBySlug, listItems, listPhotos, toCatalogItem } from '../db/queries';
import type { Catalog } from '@kw/shared/types';
import { metaFeed, googleFeed, pinterestFeed } from '../services/feeds';

export const publicRoutes = new Hono<AppContext>();

function imgBase(c: { req: { url: string } }): string {
  return new URL(c.req.url).origin;
}

export async function buildCatalog(db: D1Database, imgBaseUrl: string, siteUrl: string): Promise<Catalog> {
  const items = await listItems(db, ['available', 'reserved', 'sold']);
  const photos = await listPhotos(db, items.map((i) => i.id));
  return {
    generated_at: Math.floor(Date.now() / 1000),
    site_url: siteUrl,
    items: items.map((i) => toCatalogItem(i, photos.get(i.id) ?? [], imgBaseUrl, siteUrl)),
  };
}

publicRoutes.get('/api/catalog', async (c) => {
  const catalog = await buildCatalog(c.env.DB, imgBase(c), c.env.PUBLIC_SITE_URL);
  return c.json(catalog, 200, { 'Cache-Control': 'public, max-age=60' });
});

publicRoutes.get('/api/items/:slug', async (c) => {
  const item = await getItemBySlug(c.env.DB, c.req.param('slug'));
  if (!item || item.status === 'draft' || item.status === 'archived') return c.json({ error: 'not_found' }, 404);
  const photos = await listPhotos(c.env.DB, [item.id]);
  return c.json(toCatalogItem(item, photos.get(item.id) ?? [], imgBase(c), c.env.PUBLIC_SITE_URL), 200, {
    'Cache-Control': 'public, max-age=60',
  });
});

publicRoutes.get('/api/items/:slug/availability', async (c) => {
  const item = await getItemBySlug(c.env.DB, c.req.param('slug'));
  if (!item) return c.json({ error: 'not_found' }, 404, { 'Cache-Control': 'no-store' });
  const nowS = Math.floor(Date.now() / 1000);
  // A stale hold reads as available even before the cron releases it.
  const status = item.status === 'reserved' && (item.reserved_until ?? 0) < nowS ? 'available' : item.status;
  return c.json({ status, reserved_until: item.reserved_until }, 200, { 'Cache-Control': 'no-store' });
});

publicRoutes.get('/img/*', async (c) => {
  const key = c.req.path.replace(/^\/img\//, '');
  if (!key || key.includes('..')) return c.text('bad key', 400);
  const obj = await c.env.PHOTOS.get(key);
  if (!obj) return c.text('not found', 404);
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('Access-Control-Allow-Origin', '*');
  return new Response(obj.body, { headers });
});

publicRoutes.get('/feeds/meta.csv', async (c) => {
  const cat = await buildCatalog(c.env.DB, imgBase(c), c.env.PUBLIC_SITE_URL);
  return c.text(metaFeed(cat), 200, { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'public, max-age=300' });
});

publicRoutes.get('/feeds/google.xml', async (c) => {
  const cat = await buildCatalog(c.env.DB, imgBase(c), c.env.PUBLIC_SITE_URL);
  return c.text(googleFeed(cat), 200, { 'Content-Type': 'application/rss+xml; charset=utf-8', 'Cache-Control': 'public, max-age=300' });
});

publicRoutes.get('/feeds/pinterest.csv', async (c) => {
  const cat = await buildCatalog(c.env.DB, imgBase(c), c.env.PUBLIC_SITE_URL);
  return c.text(pinterestFeed(cat), 200, { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'public, max-age=300' });
});

publicRoutes.get('/healthz', (c) => c.json({ ok: true, ts: Date.now() }));
