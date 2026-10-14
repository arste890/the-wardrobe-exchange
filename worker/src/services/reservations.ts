// Atomic hold / sold transitions. D1 runs each statement atomically, so a single
// conditional UPDATE with a `changes` check is enough to prevent double-selling.

import { now } from '../env';
import { ulid } from './ids';
import { logEvent } from '../db/queries';

export const HOLD_SECONDS = 30 * 60; // Stripe Checkout's minimum expires_at is 30 minutes.

export async function reserveItem(db: D1Database, itemId: string): Promise<{ reservationId: string; expiresAt: number } | null> {
  const t = now();
  const reservationId = ulid();
  const expiresAt = t + HOLD_SECONDS;
  const res = await db
    .prepare(
      `UPDATE items SET status = 'reserved', reserved_until = ?, reservation_id = ?, updated_at = ?
       WHERE id = ? AND (status = 'available' OR (status = 'reserved' AND reserved_until < ?))`,
    )
    .bind(expiresAt, reservationId, t, itemId, t)
    .run();
  if (res.meta.changes !== 1) return null;
  await db
    .prepare('INSERT INTO reservations (id, item_id, expires_at, status, created_at) VALUES (?,?,?,?,?)')
    .bind(reservationId, itemId, expiresAt, 'held', t)
    .run();
  return { reservationId, expiresAt };
}

export async function attachSession(db: D1Database, reservationId: string, sessionId: string): Promise<void> {
  await db.prepare('UPDATE reservations SET stripe_session_id = ? WHERE id = ?').bind(sessionId, reservationId).run();
}

/** Put the item back on sale if this reservation still holds it. */
export async function releaseReservation(db: D1Database, reservationId: string, why: 'released' | 'expired' = 'released'): Promise<boolean> {
  const t = now();
  const res = await db
    .prepare(
      `UPDATE items SET status = 'available', reserved_until = NULL, reservation_id = NULL, updated_at = ?
       WHERE reservation_id = ? AND status = 'reserved'`,
    )
    .bind(t, reservationId)
    .run();
  await db.prepare(`UPDATE reservations SET status = ? WHERE id = ? AND status = 'held'`).bind(why, reservationId).run();
  return res.meta.changes === 1;
}

/**
 * Mark sold. With a reservationId, succeeds only if that hold still owns the item
 * (site sale). Without one (marketplace / manual), succeeds from any non-sold state.
 */
export async function markSold(
  db: D1Database,
  itemId: string,
  channel: string,
  reservationId?: string | null,
): Promise<boolean> {
  const t = now();
  const res = reservationId
    ? await db
        .prepare(
          `UPDATE items SET status = 'sold', sold_at = ?, sold_channel = ?, reserved_until = NULL, updated_at = ?
           WHERE id = ? AND reservation_id = ? AND status IN ('reserved','available')`,
        )
        .bind(t, channel, t, itemId, reservationId)
        .run()
    : await db
        .prepare(
          `UPDATE items SET status = 'sold', sold_at = ?, sold_channel = ?, reserved_until = NULL, updated_at = ?
           WHERE id = ? AND status IN ('available','reserved','draft')`,
        )
        .bind(t, channel, t, itemId)
        .run();
  if (res.meta.changes !== 1) return false;
  if (reservationId) {
    await db.prepare(`UPDATE reservations SET status = 'converted' WHERE id = ?`).bind(reservationId).run();
  } else {
    // A site hold that loses the race gets cleaned up; its Stripe session will refund on completion.
    await db.prepare(`UPDATE reservations SET status = 'released' WHERE item_id = ? AND status = 'held'`).bind(itemId).run();
  }
  return true;
}

export async function expireStaleHolds(db: D1Database): Promise<number> {
  const t = now();
  const res = await db
    .prepare(
      `UPDATE items SET status = 'available', reserved_until = NULL, reservation_id = NULL, updated_at = ?
       WHERE status = 'reserved' AND reserved_until < ?`,
    )
    .bind(t, t)
    .run();
  await db.prepare(`UPDATE reservations SET status = 'expired' WHERE status = 'held' AND expires_at < ?`).bind(t).run();
  if (res.meta.changes) await logEvent(db, { actor: 'cron', kind: 'holds_expired', payload: { count: res.meta.changes } });
  return res.meta.changes;
}
