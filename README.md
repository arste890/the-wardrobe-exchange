# The Wardrobe Exchange

A luxury resale storefront that costs nothing to run: a static Astro site on GitHub Pages, a Cloudflare Worker (D1 + R2) for inventory, Stripe Checkout with buyer-paid shipping and sales tax, an admin page for listing, and a marketplace sync layer (eBay first) so a piece sold anywhere is delisted everywhere.

```
shared/   types, shipping classes, brand config (edit shared/brand.ts to rename the store)
site/     Astro storefront + /admin page            → GitHub Pages
worker/   Hono API: catalog, checkout, webhooks, admin, feeds, cron → Cloudflare Workers
scripts/  photo cleanup CLI (Python) and a demo seed script
docs/     GO-LIVE.md (accounts, keys, DNS), EBAY-GO-LIVE.md, RUNBOOK.md (day-to-day)
```

## Local development

```bash
npm install
cp worker/.dev.vars.example worker/.dev.vars     # fill in Stripe TEST keys + an admin password hash
cp site/.env.example site/.env
npm run hash-password -w worker -- "choose-a-password"   # paste into ADMIN_PASSWORD_HASH
npm run migrate:local
npm run dev:worker          # http://localhost:8787
npm run dev:site            # http://localhost:4321  (separate terminal)
stripe listen --forward-to localhost:8787/webhooks/stripe   # optional: Stripe CLI for webhooks
ADMIN_PASSWORD=choose-a-password node scripts/seed.mjs      # optional demo items
```

Open http://localhost:4321/admin, sign in, create an item, drop photos, publish. The storefront prerenders the catalog at build time and reads live availability from the Worker, so during `astro dev` new items appear after a dev-server restart (production rebuilds automatically via `repository_dispatch`).

## Deploy

See [docs/GO-LIVE.md](docs/GO-LIVE.md). In short: push to `main` → GitHub Actions deploys the site to Pages and the Worker to Cloudflare.
