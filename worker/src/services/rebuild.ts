// Ask GitHub Actions to rebuild the static site (repository_dispatch), debounced to once a minute.

import type { Env } from '../env';
import { getSetting, setSetting } from '../db/queries';
import { now } from '../env';

const DEBOUNCE = 60;

export async function requestRebuild(env: Env, reason: string): Promise<void> {
  const last = Number((await getSetting(env.DB, 'rebuild_last_at')) ?? 0);
  if (now() - last < DEBOUNCE) {
    await setSetting(env.DB, 'rebuild_pending', reason);
    return;
  }
  await dispatch(env, reason);
}

export async function flushPendingRebuild(env: Env): Promise<void> {
  const pending = await getSetting(env.DB, 'rebuild_pending');
  if (!pending) return;
  const last = Number((await getSetting(env.DB, 'rebuild_last_at')) ?? 0);
  if (now() - last < DEBOUNCE) return;
  await dispatch(env, pending);
}

async function dispatch(env: Env, reason: string): Promise<void> {
  await setSetting(env.DB, 'rebuild_last_at', String(now()));
  await setSetting(env.DB, 'rebuild_pending', '');
  if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) {
    console.log(`[rebuild skipped — no GITHUB_TOKEN] reason=${reason}`);
    return;
  }
  const res = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/dispatches`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'the-wardrobe-exchange-worker',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({ event_type: 'catalog-changed', client_payload: { reason } }),
  });
  if (!res.ok) console.error('repository_dispatch failed', res.status, await res.text());
}
