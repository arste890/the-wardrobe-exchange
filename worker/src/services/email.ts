// Transactional email via Resend. Without RESEND_API_KEY the message is logged instead (local dev).

import type { Env } from '../env';
import type { Item, Order, ShipTo } from '@kw/shared/types';
import { BRAND } from '@kw/shared/brand';
import { formatUSD, HANDLING } from '@kw/shared/shipping';

interface Mail {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
}

export async function sendEmail(env: Env, mail: Mail): Promise<void> {
  if (!env.RESEND_API_KEY) {
    console.log(`[email → ${mail.to}] ${mail.subject}\n${mail.text}`);
    return;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.EMAIL_FROM || `${BRAND.name} <onboarding@resend.dev>`,
      to: [mail.to],
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      reply_to: mail.replyTo || BRAND.seller.email,
    }),
  });
  if (!res.ok) console.error('resend failed', res.status, await res.text());
}

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

function addressLines(a: ShipTo | null): string[] {
  if (!a) return ['(no address)'];
  return [a.name, a.line1, a.line2 || '', `${a.city}, ${a.state} ${a.postal_code}`, a.country].filter(Boolean);
}

function wrap(title: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f3ef;font-family:Georgia,serif;color:#1f1b17">
  <div style="max-width:560px;margin:0 auto;background:#fff;padding:32px;border:1px solid #e7e1d9">
    <p style="letter-spacing:.18em;font-size:12px;text-transform:uppercase;margin:0 0 24px;color:#7a6f63">${esc(BRAND.name)}</p>
    <h1 style="font-weight:normal;font-size:22px;margin:0 0 16px">${esc(title)}</h1>
    ${bodyHtml}
    <p style="font-size:12px;color:#7a6f63;margin-top:32px">${esc(BRAND.seller.name)} · ${esc(BRAND.seller.mailingAddress)} · ${esc(BRAND.seller.email)}</p>
  </div></body></html>`;
}

export function sellerNewOrder(env: Env, item: Item, order: Order): Mail {
  const lines = addressLines(order.ship_to);
  const text = `New order ${order.id}\n\n${item.brand} ${item.title} (${item.sku}) — size ${item.size_label}\nTotal ${formatUSD(order.total_cents)} (item ${formatUSD(order.subtotal_cents)} + shipping ${formatUSD(order.shipping_cents)} + tax ${formatUSD(order.tax_cents)})\n\nShip to:\n${lines.join('\n')}\nBuyer: ${order.buyer_email ?? ''}\n\nMark shipped in the admin: ${env.PUBLIC_SITE_URL}/admin/`;
  const html = wrap(
    `New order — aim to ship within ${HANDLING.max} business days`,
    `<p><strong>${esc(item.brand)} ${esc(item.title)}</strong> · ${esc(item.sku)} · size ${esc(item.size_label)}</p>
     <p>Total <strong>${formatUSD(order.total_cents)}</strong> (item ${formatUSD(order.subtotal_cents)}, shipping ${formatUSD(order.shipping_cents)}, tax ${formatUSD(order.tax_cents)})</p>
     <p style="white-space:pre-line;border-left:3px solid #e7e1d9;padding-left:12px">${lines.map(esc).join('\n')}</p>
     <p>Buyer: ${esc(order.buyer_email ?? '')}</p>
     <p><a href="${esc(env.PUBLIC_SITE_URL)}/admin/">Open admin → To ship</a></p>`,
  );
  return { to: env.SELLER_EMAIL, subject: `New order: ${item.brand} ${item.title} (${formatUSD(order.total_cents)})`, html, text };
}

export function buyerShipped(env: Env, item: Item, order: Order): Mail {
  const track = order.tracking_number ? `${order.tracking_carrier ?? ''} ${order.tracking_number}`.trim() : 'tracking to follow';
  const trackUrl = trackingUrl(order.tracking_carrier, order.tracking_number);
  const text = `Your ${item.brand} ${item.title} is on its way.\n\nTracking: ${track}${trackUrl ? `\n${trackUrl}` : ''}\n\nAll sales are final. If anything arrives materially different from the listing, reply to this email within ${BRAND.notAsDescribedWindowDays} days of delivery with photos.`;
  const html = wrap(
    'Your piece is on its way',
    `<p><strong>${esc(item.brand)} ${esc(item.title)}</strong> shipped today.</p>
     <p>Tracking: ${trackUrl ? `<a href="${esc(trackUrl)}">${esc(track)}</a>` : esc(track)}</p>
     <p style="font-size:13px;color:#7a6f63">All sales are final. If anything arrives materially different from the listing, reply within ${BRAND.notAsDescribedWindowDays} days of delivery with photos and we will make it right.</p>`,
  );
  return { to: order.buyer_email ?? env.SELLER_EMAIL, subject: `Shipped: ${item.brand} ${item.title}`, html, text };
}

export function buyerRaceRefund(env: Env, item: Item, email: string): Mail {
  const text = `We're sorry — ${item.brand} ${item.title} sold on another channel moments before your payment completed. Your payment has been refunded in full; it will appear in 5–10 business days.`;
  return { to: email, subject: `Refunded: ${item.brand} ${item.title} was no longer available`, html: wrap('Refunded in full', `<p>${esc(text)}</p>`), text };
}

export function sellerRaceRefund(env: Env, item: Item, sessionId: string): Mail {
  const text = `Race detected: ${item.sku} completed a site checkout after it was marked sold elsewhere. The Stripe payment (${sessionId}) was refunded automatically. Check the admin log.`;
  return { to: env.SELLER_EMAIL, subject: `Auto-refund: ${item.sku} double-sale avoided`, html: wrap('Double-sale avoided', `<p>${esc(text)}</p>`), text };
}

export function sellerChannelSale(env: Env, item: Item, channel: string, order: Order): Mail {
  const lines = addressLines(order.ship_to);
  const text = `${item.sku} sold on ${channel} for ${formatUSD(order.total_cents)}. Site listing marked sold; other channels delisted.\n\nShip to:\n${lines.join('\n')}\n\nShip via ${channel}'s label flow.`;
  return { to: env.SELLER_EMAIL, subject: `Sold on ${channel}: ${item.brand} ${item.title}`, html: wrap(`Sold on ${esc(channel)}`, `<p>${esc(text).replace(/\n/g, '<br>')}</p>`), text };
}

export function sellerDispute(env: Env, item: Item | null, orderId: string, amount: number): Mail {
  const text = `A chargeback was opened on order ${orderId}${item ? ` (${item.sku})` : ''} for ${formatUSD(amount)}. Respond in the Stripe Dashboard within the deadline with: the listing, photos, tracking/delivery proof, and the buyer's acceptance of the all-sales-final terms (stored on the order).`;
  return { to: env.SELLER_EMAIL, subject: `Chargeback opened on order ${orderId}`, html: wrap('Chargeback opened', `<p>${esc(text)}</p>`), text };
}

export function trackingUrl(carrier: string | null, num: string | null): string | null {
  if (!num) return null;
  const c = (carrier ?? '').toLowerCase();
  if (c.includes('usps')) return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodeURIComponent(num)}`;
  if (c.includes('ups')) return `https://www.ups.com/track?tracknum=${encodeURIComponent(num)}`;
  if (c.includes('fedex')) return `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(num)}`;
  return null;
}
