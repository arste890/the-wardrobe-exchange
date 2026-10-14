import type { Env } from '../env';
import { expireStaleHolds } from './reservations';
import { flushPendingRebuild } from './rebuild';
import { retryFailedListings, pollChannelSales } from '../channels/registry';

export async function runScheduled(env: Env): Promise<void> {
  const results = await Promise.allSettled([
    expireStaleHolds(env.DB),
    retryFailedListings(env),
    pollChannelSales(env),
  ]);
  for (const r of results) if (r.status === 'rejected') console.error('cron task failed', r.reason);
  await flushPendingRebuild(env).catch((e) => console.error('rebuild flush failed', e));
}
