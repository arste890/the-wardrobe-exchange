// eBay REST client with OAuth token refresh (authorization-code grant, user tokens).

import type { Env } from '../../env';
import { now } from '../../env';
import { decryptString, encryptString } from '../../services/auth';

export const EBAY_SCOPES = [
  'https://api.ebay.com/oauth/api_scope',
  'https://api.ebay.com/oauth/api_scope/sell.inventory',
  'https://api.ebay.com/oauth/api_scope/sell.account',
  'https://api.ebay.com/oauth/api_scope/sell.fulfillment',
];

export function ebayHosts(env: Env) {
  const sandbox = (env.EBAY_ENV ?? 'sandbox') !== 'production';
  return {
    api: sandbox ? 'https://api.sandbox.ebay.com' : 'https://api.ebay.com',
    auth: sandbox ? 'https://auth.sandbox.ebay.com' : 'https://auth.ebay.com',
    web: sandbox ? 'https://www.sandbox.ebay.com' : 'https://www.ebay.com',
  };
}

function basicAuth(env: Env): string {
  return 'Basic ' + btoa(`${env.EBAY_CLIENT_ID}:${env.EBAY_CLIENT_SECRET}`);
}

export function authorizeUrl(env: Env, state: string): string {
  const u = new URL(`${ebayHosts(env).auth}/oauth2/authorize`);
  u.searchParams.set('client_id', env.EBAY_CLIENT_ID ?? '');
  u.searchParams.set('redirect_uri', env.EBAY_RU_NAME ?? '');
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', EBAY_SCOPES.join(' '));
  u.searchParams.set('state', state);
  return u.toString();
}

export async function exchangeCode(env: Env, code: string): Promise<void> {
  const res = await fetch(`${ebayHosts(env).api}/identity/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: basicAuth(env), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: env.EBAY_RU_NAME ?? '' }),
  });
  if (!res.ok) throw new Error(`eBay token exchange failed: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { access_token: string; expires_in: number; refresh_token: string };
  await env.DB.prepare(
    `INSERT INTO channel_credentials (channel, refresh_token_enc, access_token, access_expires_at, meta_json, updated_at)
     VALUES ('ebay', ?, ?, ?, COALESCE((SELECT meta_json FROM channel_credentials WHERE channel='ebay'), '{}'), ?)
     ON CONFLICT(channel) DO UPDATE SET refresh_token_enc=excluded.refresh_token_enc, access_token=excluded.access_token,
       access_expires_at=excluded.access_expires_at, updated_at=excluded.updated_at`,
  )
    .bind(await encryptString(env.CRED_KEY, j.refresh_token), j.access_token, now() + j.expires_in - 60, now())
    .run();
}

export async function accessToken(env: Env): Promise<string> {
  const row = await env.DB.prepare('SELECT * FROM channel_credentials WHERE channel = ?').bind('ebay')
    .first<{ refresh_token_enc: string | null; access_token: string | null; access_expires_at: number | null }>();
  if (!row?.refresh_token_enc) throw new Error('eBay not connected. Use Admin → Channels → Connect eBay.');
  if (row.access_token && (row.access_expires_at ?? 0) > now()) return row.access_token;
  const refresh = await decryptString(env.CRED_KEY, row.refresh_token_enc);
  const res = await fetch(`${ebayHosts(env).api}/identity/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: basicAuth(env), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh, scope: EBAY_SCOPES.join(' ') }),
  });
  if (!res.ok) throw new Error(`eBay token refresh failed: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { access_token: string; expires_in: number };
  await env.DB.prepare('UPDATE channel_credentials SET access_token = ?, access_expires_at = ?, updated_at = ? WHERE channel = ?')
    .bind(j.access_token, now() + j.expires_in - 60, now(), 'ebay')
    .run();
  return j.access_token;
}

export async function ebayFetch<T = any>(env: Env, method: string, path: string, body?: unknown, extraHeaders: Record<string, string> = {}): Promise<T> {
  const token = await accessToken(env);
  const res = await fetch(`${ebayHosts(env).api}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Content-Language': 'en-US',
      'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
      ...extraHeaders,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`eBay ${method} ${path} → ${res.status}: ${text.slice(0, 400)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

export async function getMeta(env: Env): Promise<Record<string, string>> {
  const row = await env.DB.prepare('SELECT meta_json FROM channel_credentials WHERE channel = ?').bind('ebay').first<{ meta_json: string }>();
  try {
    return row ? JSON.parse(row.meta_json) : {};
  } catch {
    return {};
  }
}

export async function setMeta(env: Env, patch: Record<string, string>): Promise<void> {
  const cur = await getMeta(env);
  await env.DB.prepare(
    `INSERT INTO channel_credentials (channel, meta_json, updated_at) VALUES ('ebay', ?, ?)
     ON CONFLICT(channel) DO UPDATE SET meta_json = excluded.meta_json, updated_at = excluded.updated_at`,
  )
    .bind(JSON.stringify({ ...cur, ...patch }), now())
    .run();
}
