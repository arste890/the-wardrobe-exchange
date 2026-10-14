// Admin-triggered OAuth connect flow for eBay.

import { Hono } from 'hono';
import type { AppContext } from '../../env';
import { authorizeUrl, exchangeCode } from './client';
import { hmacHex } from '../../services/auth';
import { logEvent } from '../../db/queries';

export const ebayOAuthRoutes = new Hono<AppContext>();

// Returns the URL the admin UI should open in a new tab.
ebayOAuthRoutes.get('/start', async (c) => {
  if (!c.env.EBAY_CLIENT_ID || !c.env.EBAY_RU_NAME) return c.json({ error: 'ebay_not_configured', message: 'Set EBAY_CLIENT_ID, EBAY_CLIENT_SECRET and EBAY_RU_NAME secrets first.' }, 400);
  const day = Math.floor(Date.now() / 86400000);
  const state = `${day}.${await hmacHex(c.env.SESSION_SECRET, `ebay-${day}`)}`;
  return c.json({ url: authorizeUrl(c.env, state) });
});

// eBay redirects here (the RuName's "accepted" URL) with ?code=…&state=…
ebayOAuthRoutes.get('/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state') ?? '';
  const [day, sig] = state.split('.');
  const expected = await hmacHex(c.env.SESSION_SECRET, `ebay-${day}`);
  if (!code || sig !== expected) return c.text('Invalid state', 400);
  try {
    await exchangeCode(c.env, code);
    await logEvent(c.env.DB, { actor: 'admin', kind: 'ebay_connected' });
    return c.redirect(`${c.env.PUBLIC_SITE_URL.replace(/\/$/, '')}/admin/?ebay=connected`);
  } catch (e) {
    return c.text(`eBay connection failed: ${(e as Error).message}`, 502);
  }
});
