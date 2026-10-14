import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { AppContext, Env } from './env';
import { allowedOrigins } from './env';
import { publicRoutes } from './routes/public';
import { checkoutRoutes } from './routes/checkout';
import { webhookRoutes } from './routes/webhooks';
import { adminRoutes } from './routes/admin';
import { runScheduled } from './services/cron';

const app = new Hono<AppContext>();

app.use('*', async (c, next) => {
  const origins = allowedOrigins(c.env);
  const path = new URL(c.req.url).pathname;
  // Public read endpoints are open; state-changing endpoints are limited to the storefront origins.
  const open = path.startsWith('/api/') || path.startsWith('/img/') || path.startsWith('/feeds/') || path === '/healthz';
  return cors({
    origin: (origin) => {
      if (!origin) return origin;
      if (open) return origin;
      if (origins.includes(origin)) return origin;
      if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin;
      return '';
    },
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Photo-Width', 'X-Photo-Height'],
    maxAge: 600,
  })(c, next);
});

app.route('/', publicRoutes);
app.route('/', checkoutRoutes);
app.route('/', webhookRoutes);
app.route('/admin', adminRoutes);

app.notFound((c) => c.json({ error: 'not_found' }, 404));
app.onError((err, c) => {
  console.error('unhandled', err);
  return c.json({ error: 'internal', message: err.message }, 500);
});

export default {
  fetch: app.fetch,
  scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runScheduled(env));
  },
};
