# eBay sync — go-live

The Worker lists each published item on eBay (Inventory + Offer APIs), withdraws it the moment it sells on the site, and polls eBay every 5 minutes for sales so the site marks the item sold and ends it elsewhere. Until the keys exist, `CHANNELS=mock` records listings locally so you can test the flow.

## Ground rules (eBay policy)
- Never mention this site, a cheaper price elsewhere, or a link in eBay listings or messages. The adapter writes descriptions without URLs; keep it that way. Violations get listings pulled and accounts suspended.
- eBay price = site price × 1.12 (covers the ~13.6% final-value fee) so the site is always cheapest. Change `EBAY_MARKUP` in `worker/src/channels/ebay/mapping.ts` if your fee rate differs.
- Use the same brand name (`thewardrobeexchange`) as your eBay username so buyers can find you by name.

## Steps
1. **you** — eBay seller account (personal is fine). Complete seller registration and payouts.
2. **you** — Join the eBay Developers Program (developer.ebay.com, free). Create an application → **Sandbox** keyset first.
3. In the keyset: "User Tokens" → add an **eBay Redirect URL** (RuName). Set its *Your auth accepted URL* to `https://<worker>/admin/channels/ebay/oauth/callback`. Copy the RuName.
4. Worker secrets: `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`, `EBAY_RU_NAME`, `EBAY_ENV=sandbox`. Set `CHANNELS = "ebay"` in `wrangler.toml` (or `"mock,ebay"` to keep both). Redeploy.
5. `/admin` → Channels → **Connect eBay** → sign in with a *sandbox test user* (create one under Sandbox → Register a test user) → consent. You land back in admin with `?ebay=connected`.
6. `/admin` → Channels → **Run eBay setup**: opts in to business policies, creates a flat-rate fulfillment policy, an immediate-pay payment policy, a no-returns return policy and your ship-from location. Ids are stored encrypted in D1.
7. Publish an item on the site → Channels tab shows the sandbox listing URL. Buy it on the site (Stripe test card) → listing ends. Create a sandbox order for another item → within 5 min (or **Poll now**) the site marks it sold.
8. **Production keys**: eBay requires a *Marketplace account deletion* notification endpoint before issuing production keys. Use `https://<worker>/webhooks/ebay/account-deletion`, set a verification token → Worker secret `EBAY_VERIFICATION_TOKEN`. Then swap the secrets to the production keyset, `EBAY_ENV=production`, reconnect with your real account, run setup again.
9. Category ids in `mapping.ts` are eBay US women's leaf categories; adjust per category if eBay rejects an offer (the error appears in Channels → Listings).

## Day to day
- Nothing. Publish on the site; the rest is automatic. Sales on eBay email you with the address; ship through eBay's label flow and mark the order shipped in admin for your records.
- If a listing shows **error**, hover it for the message; fix the item (usually a missing aspect or image) and click Resync.
