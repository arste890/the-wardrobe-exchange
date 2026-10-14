# Go-live checklist

Work top to bottom. Items marked **you** need your accounts or identity; everything else is already built.

## 0. Decide the name
- [ ] **you** — Keep "The Wardrobe Exchange" or change `shared/brand.ts` (name, short code, email, Instagram/eBay handles, city). Everything else picks it up.
- [ ] **you** — Register the domain (Cloudflare Registrar sells at cost; `thewardrobeexchange.shop` and `thewardrobe-exchange.com` were free on 2026-10-14; `thewardrobeexchange.com` is taken). Launch on `arste890.github.io/the-wardrobe-exchange` meanwhile.
- [ ] **you** — A PO box or mailing address → `shared/brand.ts` `seller.mailingAddress` (required in Terms notices and newsletter footers under CAN-SPAM).

## 1. GitHub (site hosting)
- [ ] **you** — Create a **public** repo `arste890/the-wardrobe-exchange` (public is required for free Pages) and push this folder (`git remote add origin … && git push -u origin main`).
- [ ] Settings → Pages → Source: **GitHub Actions**.
- [ ] Settings → Secrets and variables → Actions:
  - Variables: `PUBLIC_API_URL` = your Worker URL (step 2), `PUBLIC_SITE_URL` = `https://arste890.github.io/the-wardrobe-exchange` (later your domain), `PAGES_BASE` = `/the-wardrobe-exchange` (later `/`).
  - Secrets: `CLOUDFLARE_API_TOKEN` (step 2), `CLOUDFLARE_ACCOUNT_ID`.
- [ ] **you** — Fine-grained personal access token with *Contents: read & write* on this repo only → Worker secret `GITHUB_TOKEN` (lets the Worker trigger rebuilds when you publish).

## 2. Cloudflare (API, database, photos)
- [ ] **you** — Free Cloudflare account. `npm i -g wrangler && wrangler login`.
- [ ] `wrangler d1 create the-wardrobe-exchange` → paste the `database_id` into `worker/wrangler.toml`.
- [ ] `wrangler r2 bucket create the-wardrobe-exchange-photos` (R2 needs a card on file but the free tier is 10 GB; nothing is charged).
- [ ] `npm run migrate:remote`
- [ ] Secrets (`cd worker && wrangler secret put NAME`, one at a time): `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `ADMIN_PASSWORD_HASH` (from `npm run hash-password -w worker -- "pw"`), `SESSION_SECRET` (`openssl rand -base64 48`), `CRED_KEY` (`openssl rand -base64 32`), `RESEND_API_KEY`, `EMAIL_FROM`, `SELLER_EMAIL`, `GITHUB_TOKEN`.
- [ ] `wrangler.toml` vars: `PUBLIC_SITE_URL`, `ALLOWED_ORIGINS` (add your Pages URL and later your domain), `GITHUB_REPO`.
- [ ] `npm run deploy:worker` → note the `https://the-wardrobe-exchange-api.<you>.workers.dev` URL → GitHub variable `PUBLIC_API_URL`.
- [ ] API token for CI: Cloudflare dashboard → My Profile → API Tokens → "Edit Cloudflare Workers" template, plus D1 edit → GitHub secret `CLOUDFLARE_API_TOKEN`.

## 3. Stripe (payments, tax)
- [ ] **you** — Create a Stripe account as an **Individual** (SSN last 4, DOB, bank account; must be 18+). Use **test mode** first.
- [ ] Developers → API keys → secret key → `STRIPE_SECRET_KEY` (test, then live).
- [ ] Developers → Webhooks → Add endpoint `https://<worker>/webhooks/stripe`, events: `checkout.session.completed`, `checkout.session.expired`, `charge.refunded`, `charge.dispute.created` → signing secret → `STRIPE_WEBHOOK_SECRET`.
- [ ] Settings → Tax: enable **Stripe Tax**; origin address = your Utah address; add a **Utah** registration once you hold a sales-tax license (step 5); default product tax code: *Clothing* (txcd_30011000).
- [ ] Settings → Checkout and Payment Links → set **Terms of service URL** (`…/policies/terms`) and **Privacy policy URL** (`…/policies/privacy`) — required for the checkout consent checkbox.
- [ ] Settings → Public details: statement descriptor `WARDROBE EXCHANGE`, support email, website.
- [ ] Test: buy a demo item with card `4242 4242 4242 4242`, any future date, any CVC, a Utah ZIP. Item flips to Sold; you get the email; `/admin` → To ship shows the address.
- [ ] Go live: flip to live keys, re-create the webhook in live mode, `wrangler secret put` both again.

## 4. Email (Resend)
- [ ] **you** — Free Resend account; add your domain, copy the DKIM/SPF/DMARC records into Cloudflare DNS; sender `orders@<domain>` → `EMAIL_FROM`, API key → `RESEND_API_KEY`. Until the domain exists, Resend's `onboarding@resend.dev` can only email *you* (`SELLER_EMAIL`), which is enough for testing.

## 5. Utah tax (you are the seller of record on your own site)
- [ ] **you** — If you sell regularly, file the free **TC-69** online at tap.utah.gov (needs SSN) for a sales-tax license, then add the Utah registration in Stripe Tax so the correct rate is collected and tracked. Remit through TAP on the schedule they assign (usually annual at low volume).
- [ ] **you** — Not sure whether casual sales of personal items require it? Call the Utah State Tax Commission, 801-297-2200, before launch. Keep a simple spreadsheet of what each item cost you; Stripe sends a 1099-K only above the federal threshold ($20,000 **and** 200 transactions), and selling personal items at a loss is not taxable income, but records make that easy to show.
- [ ] Other states: nothing to do below $100,000/year in sales to a state.

## 6. Domain (when you have it)
- [ ] DNS in Cloudflare: `A @` → 185.199.108.153 / 109.153 / 110.153 / 111.153, `CNAME www` → `arste890.github.io` (DNS-only, not proxied), `CNAME api` → Worker custom domain (Workers → Settings → Domains & Routes → add `api.<domain>`).
- [ ] GitHub → Settings → Pages → Custom domain = `<domain>`, enforce HTTPS. Add `site/public/CNAME` containing the domain.
- [ ] GitHub variables: `PUBLIC_SITE_URL` = `https://<domain>`, `PAGES_BASE` = `/`, `PUBLIC_API_URL` = `https://api.<domain>`. `wrangler.toml`: `PUBLIC_SITE_URL`, add the domain to `ALLOWED_ORIGINS`. Update Stripe success/cancel behaviour by redeploying the Worker.

## 7. Before the first real sale
- [ ] Read `/policies/terms`, `/policies/photos`, `/policies/shipping`, `/policies/privacy` once more; bump `policyVersion` + `policyEffectiveDate` in `shared/brand.ts` if you changed anything.
- [ ] Live $1 test purchase from your own card, then refund it in the Stripe dashboard. Confirm both emails arrive and the item shows Sold.
- [ ] Validate feeds: `https://<worker>/feeds/google.xml` in Merchant Center, `/feeds/meta.csv` in Commerce Manager (see docs/RUNBOOK.md).

## 8. eBay
See [EBAY-GO-LIVE.md](EBAY-GO-LIVE.md).
