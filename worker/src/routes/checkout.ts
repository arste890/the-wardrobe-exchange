import { Hono } from 'hono';
import type { AppContext } from '../env';
import { getItemById, listPhotos, logEvent, toCatalogItem } from '../db/queries';
import { reserveItem, releaseReservation, attachSession, HOLD_SECONDS } from '../services/reservations';
import { createCheckoutSession, retrieveCheckoutSession, StripeError } from '../services/stripe';
import { BRAND } from '@kw/shared/brand';

export const checkoutRoutes = new Hono<AppContext>();

checkoutRoutes.post('/checkout', async (c) => {
  let body: { item_id?: string; acknowledged_policies?: boolean; policy_version?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'bad_request' }, 400);
  }
  if (!body.item_id) return c.json({ error: 'bad_request', message: 'item_id required' }, 400);
  if (body.acknowledged_policies !== true) {
    return c.json({ error: 'policies_not_acknowledged', message: 'You must accept the all-sales-final terms before checkout.' }, 400);
  }

  const item = await getItemById(c.env.DB, body.item_id);
  if (!item || item.status === 'draft' || item.status === 'archived') return c.json({ error: 'not_found' }, 404);
  if (item.status === 'sold') return c.json({ error: 'unavailable', message: 'This piece has sold.' }, 409);

  const hold = await reserveItem(c.env.DB, item.id);
  if (!hold) {
    return c.json({ error: 'unavailable', message: 'Someone else is checking out with this piece right now. Try again in a few minutes.' }, 409);
  }

  try {
    const photos = await listPhotos(c.env.DB, [item.id]);
    const cat = toCatalogItem(item, photos.get(item.id) ?? [], new URL(c.req.url).origin, c.env.PUBLIC_SITE_URL);
    const session = await createCheckoutSession(c.env, item, cat.cover, hold.reservationId, body.policy_version || BRAND.policyVersion, HOLD_SECONDS);
    await attachSession(c.env.DB, hold.reservationId, session.id);
    await logEvent(c.env.DB, { actor: 'buyer', kind: 'checkout_started', item_id: item.id, payload: { session: session.id, reservation: hold.reservationId } });
    return c.json({ url: session.url, expires_at: hold.expiresAt });
  } catch (e) {
    await releaseReservation(c.env.DB, hold.reservationId);
    const msg = e instanceof StripeError ? `Stripe error: ${(e.body as any)?.error?.message ?? e.message}` : (e as Error).message;
    await logEvent(c.env.DB, { actor: 'system', kind: 'checkout_failed', item_id: item.id, payload: { message: msg } });
    console.error('checkout failed', msg);
    return c.json({ error: 'checkout_failed', message: 'Checkout could not be started. Please try again.' }, 502);
  }
});

/** Order summary for the success page (safe subset; no card data). */
checkoutRoutes.get('/checkout/session/:id', async (c) => {
  const id = c.req.param('id');
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(id)) return c.json({ error: 'bad_request' }, 400);
  try {
    const s = await retrieveCheckoutSession(c.env, id);
    const item = s.metadata?.item_id ? await getItemById(c.env.DB, s.metadata.item_id) : null;
    return c.json(
      {
        id: s.id,
        payment_status: s.payment_status,
        amount_subtotal: s.amount_subtotal,
        amount_shipping: s.total_details?.amount_shipping ?? 0,
        amount_tax: s.total_details?.amount_tax ?? 0,
        amount_total: s.amount_total,
        email: s.customer_details?.email ?? null,
        item: item ? { title: item.title, brand: item.brand, slug: item.slug, sku: item.sku, size_label: item.size_label } : null,
      },
      200,
      { 'Cache-Control': 'no-store' },
    );
  } catch {
    return c.json({ error: 'not_found' }, 404);
  }
});
