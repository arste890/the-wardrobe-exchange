// Minimal Stripe client for Workers: form-encoded requests + webhook signature verification.

import type { Env } from '../env';
import type { Item, PhotoSrc } from '@kw/shared/types';
import { SHIPPING_CLASSES, SHIPPING_DAYS, SHIPPING_SERVICE } from '@kw/shared/shipping';
import { BRAND } from '@kw/shared/brand';
import { CONDITION_LABELS } from '@kw/shared/types';
import { hmacHex } from './auth';
import { timingSafeEqual } from './ids';

const API = 'https://api.stripe.com/v1';

type Params = Record<string, unknown>;

/** Flatten {a:{b:1}, c:[x,y]} into Stripe's bracket form encoding. */
export function toForm(obj: Params, prefix = '', out = new URLSearchParams()): URLSearchParams {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item !== null && typeof item === 'object') toForm(item as Params, `${key}[${i}]`, out);
        else out.append(`${key}[${i}]`, String(item));
      });
    } else if (typeof v === 'object') {
      toForm(v as Params, key, out);
    } else {
      out.append(key, String(v));
    }
  }
  return out;
}

export class StripeError extends Error {
  constructor(public status: number, public body: unknown) {
    super(`Stripe ${status}: ${JSON.stringify(body).slice(0, 300)}`);
  }
}

export async function stripe<T = any>(env: Env, method: 'GET' | 'POST' | 'DELETE', path: string, params?: Params, idempotencyKey?: string): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  let url = `${API}${path}`;
  let body: string | undefined;
  if (params) {
    const form = toForm(params).toString();
    if (method === 'GET') url += `?${form}`;
    else body = form;
  }
  const res = await fetch(url, { method, headers, body });
  const json = (await res.json()) as T;
  if (!res.ok) throw new StripeError(res.status, json);
  return json;
}

export interface CheckoutSession {
  id: string;
  url: string | null;
  payment_status: 'paid' | 'unpaid' | 'no_payment_required';
  payment_intent: string | null;
  amount_subtotal: number;
  amount_total: number;
  total_details?: { amount_shipping: number; amount_tax: number; amount_discount: number };
  customer_details?: { email: string | null; name: string | null; address?: StripeAddress | null } | null;
  collected_information?: { shipping_details?: { name: string; address: StripeAddress } | null } | null;
  shipping_details?: { name: string; address: StripeAddress } | null;
  metadata: Record<string, string>;
}

export interface StripeAddress {
  line1: string | null;
  line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string | null;
}

export async function createCheckoutSession(
  env: Env,
  item: Item,
  cover: PhotoSrc | null,
  reservationId: string,
  policyVersion: string,
  holdSeconds: number,
): Promise<CheckoutSession> {
  const site = env.PUBLIC_SITE_URL.replace(/\/$/, '');
  const ship = SHIPPING_CLASSES[item.shipping_class];
  const name = `${item.brand} ${item.title}`.trim().slice(0, 250);
  const description = `Size ${item.size_label} · ${CONDITION_LABELS[item.condition_grade]} · SKU ${item.sku}`;
  const params: Params = {
    mode: 'payment',
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: item.price_cents,
          tax_behavior: 'exclusive',
          product_data: {
            name,
            description,
            images: cover ? [cover.jpg] : undefined,
            tax_code: item.tax_code,
            metadata: { item_id: item.id, sku: item.sku },
          },
        },
      },
    ],
    shipping_address_collection: { allowed_countries: ['US'] },
    shipping_options: [
      {
        shipping_rate_data: {
          type: 'fixed_amount',
          fixed_amount: { amount: ship.cents, currency: 'usd' },
          display_name: SHIPPING_SERVICE,
          tax_behavior: 'exclusive',
          tax_code: 'txcd_92010001',
          delivery_estimate: {
            minimum: { unit: 'business_day', value: SHIPPING_DAYS.min },
            maximum: { unit: 'business_day', value: SHIPPING_DAYS.max },
          },
        },
      },
    ],
    automatic_tax: { enabled: true },
    customer_creation: 'if_required',
    consent_collection: { terms_of_service: 'required' },
    custom_text: {
      submit: { message: 'All sales are final. By paying you accept the Terms of Sale and the Photo & Condition Disclaimer.' },
      terms_of_service_acceptance: {
        message: `I agree to the [Terms of Sale](${site}/policies/terms) — all sales final — and the [Photo & Condition Disclaimer](${site}/policies/photos).`,
      },
    },
    expires_at: Math.floor(Date.now() / 1000) + holdSeconds,
    metadata: { item_id: item.id, reservation_id: reservationId, sku: item.sku, policy_version: policyVersion },
    payment_intent_data: {
      metadata: { item_id: item.id, sku: item.sku },
      statement_descriptor_suffix: BRAND.descriptor.slice(0, 22),
      description: `${name} (${item.sku})`,
    },
    success_url: `${site}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${site}/item/${item.slug}?cancelled=1`,
  };
  return stripe<CheckoutSession>(env, 'POST', '/checkout/sessions', params, `cs-${reservationId}`);
}

export async function retrieveCheckoutSession(env: Env, id: string): Promise<CheckoutSession> {
  return stripe<CheckoutSession>(env, 'GET', `/checkout/sessions/${id}`);
}

export async function expireCheckoutSession(env: Env, id: string): Promise<void> {
  try {
    await stripe(env, 'POST', `/checkout/sessions/${id}/expire`);
  } catch (e) {
    // Already expired/completed — nothing to do.
    console.warn('expire session', (e as Error).message);
  }
}

export async function refundPaymentIntent(env: Env, paymentIntent: string, reason: string): Promise<void> {
  await stripe(env, 'POST', '/refunds', { payment_intent: paymentIntent, metadata: { reason } }, `refund-${paymentIntent}`);
}

/** Verify a Stripe-Signature header against the raw body. */
export async function verifyStripeSignature(payload: string, header: string | undefined, secret: string, toleranceSec = 300): Promise<boolean> {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(',').map((kv) => {
      const i = kv.indexOf('=');
      return [kv.slice(0, i), kv.slice(i + 1)];
    }),
  ) as Record<string, string>;
  const t = Number(parts.t);
  if (!t || Math.abs(Math.floor(Date.now() / 1000) - t) > toleranceSec) return false;
  const expected = await hmacHex(secret, `${t}.${payload}`);
  // There may be multiple v1 signatures during secret rotation.
  const sigs = header
    .split(',')
    .filter((kv) => kv.startsWith('v1='))
    .map((kv) => kv.slice(3));
  return sigs.some((s) => timingSafeEqual(s, expected));
}

export function shipToFromSession(s: CheckoutSession) {
  const sd = s.collected_information?.shipping_details ?? s.shipping_details ?? null;
  if (!sd?.address) return null;
  return {
    name: sd.name,
    line1: sd.address.line1 ?? '',
    line2: sd.address.line2,
    city: sd.address.city ?? '',
    state: sd.address.state ?? '',
    postal_code: sd.address.postal_code ?? '',
    country: sd.address.country ?? 'US',
  };
}
