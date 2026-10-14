import { Hono } from 'hono';
import type { AppContext, Env } from '../env';
import { now } from '../env';
import { getItemById, logEvent } from '../db/queries';
import { markSold, releaseReservation } from '../services/reservations';
import { verifyStripeSignature, refundPaymentIntent, shipToFromSession, type CheckoutSession } from '../services/stripe';
import { sendEmail, sellerNewOrder, buyerRaceRefund, sellerRaceRefund, sellerDispute } from '../services/email';
import { requestRebuild } from '../services/rebuild';
import { delistEverywhere } from '../channels/registry';
import { ulid } from '../services/ids';
import type { Order } from '@kw/shared/types';

export const webhookRoutes = new Hono<AppContext>();

webhookRoutes.post('/webhooks/stripe', async (c) => {
  const payload = await c.req.text();
  const ok = await verifyStripeSignature(payload, c.req.header('stripe-signature'), c.env.STRIPE_WEBHOOK_SECRET);
  if (!ok) return c.json({ error: 'bad_signature' }, 400);

  const event = JSON.parse(payload) as { id: string; type: string; data: { object: any } };

  // Idempotency: Stripe retries; the PK insert fails on a duplicate.
  try {
    await c.env.DB.prepare('INSERT INTO stripe_events (id, type, received_at) VALUES (?,?,?)').bind(event.id, event.type, now()).run();
  } catch {
    return c.json({ received: true, duplicate: true });
  }

  const env = c.env;
  switch (event.type) {
    case 'checkout.session.completed':
      c.executionCtx.waitUntil(handleCompleted(env, event.data.object as CheckoutSession));
      break;
    case 'checkout.session.expired':
      c.executionCtx.waitUntil(handleExpired(env, event.data.object as CheckoutSession));
      break;
    case 'charge.refunded':
      c.executionCtx.waitUntil(handleRefunded(env, event.data.object));
      break;
    case 'charge.dispute.created':
      c.executionCtx.waitUntil(handleDispute(env, event.data.object));
      break;
    default:
      break;
  }
  return c.json({ received: true });
});

async function handleCompleted(env: Env, s: CheckoutSession): Promise<void> {
  const itemId = s.metadata?.item_id;
  const reservationId = s.metadata?.reservation_id;
  if (!itemId || !reservationId) return;
  if (s.payment_status !== 'paid') return; // async payment methods are off; be safe anyway

  const item = await getItemById(env.DB, itemId);
  if (!item) return;

  const sold = await markSold(env.DB, itemId, 'site', reservationId);
  if (!sold) {
    // Lost the race to a marketplace sale (or a manual "mark sold"). Refund immediately.
    await logEvent(env.DB, { actor: 'webhook', kind: 'race_refund', item_id: itemId, payload: { session: s.id } });
    if (s.payment_intent) await refundPaymentIntent(env, s.payment_intent, 'sold_elsewhere_during_checkout');
    if (s.customer_details?.email) await sendEmail(env, buyerRaceRefund(env, item, s.customer_details.email));
    await sendEmail(env, sellerRaceRefund(env, item, s.id));
    return;
  }

  const order: Order = {
    id: ulid(),
    item_id: itemId,
    channel: 'site',
    external_id: s.id,
    stripe_payment_intent: s.payment_intent,
    buyer_email: s.customer_details?.email ?? null,
    buyer_name: s.customer_details?.name ?? shipToFromSession(s)?.name ?? null,
    ship_to: shipToFromSession(s),
    subtotal_cents: s.amount_subtotal,
    shipping_cents: s.total_details?.amount_shipping ?? 0,
    tax_cents: s.total_details?.amount_tax ?? 0,
    total_cents: s.amount_total,
    status: 'paid',
    tracking_carrier: null,
    tracking_number: null,
    shipped_at: null,
    policy_version: s.metadata?.policy_version ?? null,
    created_at: now(),
  };
  await env.DB.prepare(
    `INSERT INTO orders (id, item_id, channel, external_id, stripe_payment_intent, buyer_email, buyer_name, ship_to_json,
       subtotal_cents, shipping_cents, tax_cents, total_cents, status, policy_version, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(
      order.id, order.item_id, order.channel, order.external_id, order.stripe_payment_intent, order.buyer_email, order.buyer_name,
      order.ship_to ? JSON.stringify(order.ship_to) : null, order.subtotal_cents, order.shipping_cents, order.tax_cents, order.total_cents,
      order.status, order.policy_version, order.created_at,
    )
    .run();
  await logEvent(env.DB, { actor: 'webhook', kind: 'order_paid', item_id: itemId, order_id: order.id, payload: { total: order.total_cents } });

  await Promise.allSettled([
    sendEmail(env, sellerNewOrder(env, item, order)),
    delistEverywhere(env, item, 'sold_site'),
    requestRebuild(env, `sold ${item.sku}`),
  ]);
}

async function handleExpired(env: Env, s: CheckoutSession): Promise<void> {
  const reservationId = s.metadata?.reservation_id;
  if (!reservationId) return;
  const released = await releaseReservation(env.DB, reservationId, 'expired');
  if (released) await logEvent(env.DB, { actor: 'webhook', kind: 'hold_released', item_id: s.metadata?.item_id, payload: { session: s.id } });
}

async function handleRefunded(env: Env, charge: { payment_intent: string | null; refunded: boolean; amount_refunded: number }): Promise<void> {
  if (!charge.payment_intent) return;
  const res = await env.DB.prepare(`UPDATE orders SET status = 'refunded' WHERE stripe_payment_intent = ? AND status != 'refunded'`)
    .bind(charge.payment_intent)
    .run();
  if (res.meta.changes) {
    const o = await env.DB.prepare('SELECT id, item_id FROM orders WHERE stripe_payment_intent = ?').bind(charge.payment_intent).first<{ id: string; item_id: string }>();
    await logEvent(env.DB, { actor: 'webhook', kind: 'order_refunded', item_id: o?.item_id, order_id: o?.id, payload: { amount: charge.amount_refunded } });
  }
}

async function handleDispute(env: Env, dispute: { payment_intent: string | null; amount: number; id: string }): Promise<void> {
  if (!dispute.payment_intent) return;
  const o = await env.DB.prepare('SELECT id, item_id FROM orders WHERE stripe_payment_intent = ?').bind(dispute.payment_intent).first<{ id: string; item_id: string }>();
  if (o) await env.DB.prepare(`UPDATE orders SET status = 'disputed' WHERE id = ?`).bind(o.id).run();
  const item = o ? await getItemById(env.DB, o.item_id) : null;
  await logEvent(env.DB, { actor: 'webhook', kind: 'dispute_opened', item_id: o?.item_id, order_id: o?.id, payload: { dispute: dispute.id } });
  await sendEmail(env, sellerDispute(env, item, o?.id ?? dispute.payment_intent, dispute.amount));
}

// eBay requires this endpoint before issuing production keys (marketplace account deletion notifications).
webhookRoutes.get('/webhooks/ebay/account-deletion', async (c) => {
  const challenge = c.req.query('challenge_code');
  const token = (c.env as any).EBAY_VERIFICATION_TOKEN as string | undefined;
  if (!challenge || !token) return c.json({ error: 'not_configured' }, 400);
  const endpoint = new URL(c.req.url);
  endpoint.search = '';
  const data = new TextEncoder().encode(challenge + token + endpoint.toString());
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map((b) => b.toString(16).padStart(2, '0')).join('');
  return c.json({ challengeResponse: hash });
});

webhookRoutes.post('/webhooks/ebay/account-deletion', async (c) => {
  await logEvent(c.env.DB, { actor: 'webhook', kind: 'ebay_account_deletion', payload: await c.req.json().catch(() => null) });
  return c.json({ ok: true });
});
