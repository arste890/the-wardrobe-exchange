# Runbook — selling day to day

## List a piece (≈10 minutes)

Shipping promise on the site is "usually within 3–5 business days" (not a guarantee). Change `HANDLING` in `shared/shipping.ts` if your routine differs.
1. Steam it, hang it on a slim hanger against the plain wall, shoot front / back / open / label / any flaws (see `scripts/photo/README.md`).
2. `uv run scripts/photo/cleanup.py shots/ ready/` (and `--no-matte` for label close-ups). Add any studio renderings as `studio_*.jpg`.
3. `/admin` → **+ New item**: brand, title, category, size on the label, condition, flaws (one per line — be blunt), description, price, original retail, shipping class → **Create draft**. Measurements are optional; add any you have (buyers can email for a specific one).
4. Drop the `ready/` folder on the photo box. Set the cover (★) — a studio rendering makes the best cover; the first Actual photo is used if there is none.
5. **Publish**. The site rebuilds in ~2 minutes; marketplaces list automatically.

## When something sells
- **On the site**: you get an email with the address. `/admin` → To ship → Copy address → buy a USPS Ground Advantage label (Pirate Ship is cheapest), pack with tissue, add signature for ≥ $500. Paste the tracking → **Mark shipped**; the buyer is emailed automatically.
- **On eBay**: email arrives too; ship via eBay's label; mark shipped in admin for your records.
- **On Poshmark / Facebook / in person**: open the item → **Mark sold elsewhere** → choose where. Other listings end automatically.

## Problems
| Symptom | Do |
|---|---|
| Buyer says item not as described | Reply within 1 business day, ask for photos. If genuine: send a prepaid label (Pirate Ship → "Return label"), refund in Stripe when it arrives. Log it in the order note. |
| Chargeback email | Stripe dashboard → Disputes → submit: listing screenshot, Actual item photos, tracking with delivery scan, the order's `policy_version` showing the terms accepted. |
| Item stuck "reserved" | Someone abandoned checkout; it clears itself in 30 min. Or open the item → **Release hold**. |
| Listing error on a channel | Channels tab → read the error → fix → Resync. |
| Site not updating after publish | Admin → **Rebuild site**. Check the GitHub Actions run if it still lags. |
| Need to change price/description | Edit the item → Save. Live listings update; site rebuilds. |

## Feeds (free discovery)
- Google Merchant Center: Products → Feeds → add scheduled fetch of `https://<worker>/feeds/google.xml`, daily. Free listings only (no ads needed).
- Meta Commerce Manager: Catalog → Data sources → scheduled feed `https://<worker>/feeds/meta.csv`, hourly. Link Instagram, set checkout to "on website".
- Pinterest: Catalogs → add data source `https://<worker>/feeds/pinterest.csv`.
- Newsletter: create a Buttondown account, set `newsletter.buttondownUsername` in `shared/brand.ts`, redeploy. Every email needs your mailing address and an unsubscribe link (Buttondown adds both).

## Monthly
- Export Stripe payouts for your records; if you hold a Utah sales-tax license, Stripe Tax → Registrations shows what to remit on TAP.
- Glance at `/admin` → Log for anything unexpected (`race_refund`, `channel_error`).
