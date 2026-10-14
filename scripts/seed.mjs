#!/usr/bin/env node
// Seed demo items through the admin API (works against local wrangler dev or production).
//
//   ADMIN_PASSWORD=... node scripts/seed.mjs [--api http://localhost:8787] [--photos ./.local/seed-photos]
//
// --photos: a folder with one sub-folder per demo item (in order). Files inside are uploaded as photos;
//           studio_* → Studio rendering, flaw_* → flaw, else Actual item. Photos are uploaded unresized
//           (the admin UI resizes in the browser; this is only for demo data).

import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => (a.startsWith('--') ? [a.slice(2), arr[i + 1]] : [])).filter((x) => x.length));
const API = (args.api || 'http://localhost:8787').replace(/\/$/, '');
const PHOTOS = args.photos || '.local/seed-photos';
const PASSWORD = process.env.ADMIN_PASSWORD;
if (!PASSWORD) {
  console.error('Set ADMIN_PASSWORD (the plain password matching ADMIN_PASSWORD_HASH).');
  process.exit(1);
}

const DEMO = [
  {
    brand: 'Remy', title: 'Metallic rose-gold leather jacket', category: 'outerwear', size_label: 'XL', size_system: 'US', color: 'Rose gold / blush', material: 'Lambskin leather, satin lining',
    condition_grade: 'very_good', condition_notes: 'Soft, supple lambskin with an all-over metallic finish that has mellowed beautifully.',
    flaws: [{ text: 'Light creasing across the back from storage (not cracked).' }, { text: 'Faint wear on the metallic finish at the front hem edge.' }],
    description_md: 'A **Remy USA** collarless leather jacket in a soft blush rose-gold metallic lambskin. Band collar with tonal piping, slim silver-tone front zip, angled welt pockets and a lustrous satin lining.\n\nCut straight with a gently curved hem; wears like a light blazer over knits.',
    price_cents: 14500, original_price_cents: 39500, shipping_class: 'outerwear',
    measurements: { chest: 58, shoulder: 46, sleeve: 61, length: 62 },
  },
  { brand: 'Toteme', title: 'Wool-blend signature scarf jacket', category: 'outerwear', size_label: 'S', size_system: 'EU', color: 'Camel', material: 'Wool blend', condition_grade: 'excellent', flaws: [], description_md: 'The oversized scarf-collar jacket. Worn twice.', price_cents: 42000, original_price_cents: 89000, shipping_class: 'coats_boots', measurements: { chest: 60, shoulder: 52, sleeve: 56, length: 78 } },
  { brand: 'The Row', title: 'Silk crepe blouse', category: 'tops', size_label: 'M', size_system: 'US', color: 'Ivory', material: '100% silk', condition_grade: 'very_good', flaws: [{ text: 'Tiny pull at the back hem, 3 mm.' }], description_md: 'Fluid silk crepe with covered buttons. Dry-cleaned.', price_cents: 29000, original_price_cents: 119000, shipping_class: 'tops', measurements: { chest: 52, shoulder: 40, sleeve: 60, length: 64 } },
  { brand: 'Khaite', title: 'Danielle straight-leg jeans', category: 'denim', size_label: '27', size_system: 'US', color: 'Vintage indigo', material: '100% cotton', condition_grade: 'good', flaws: [{ text: 'Soft whiskering and light fade at the thighs.' }, { text: 'Hem let down by 2 cm; crease line visible.' }], description_md: 'Rigid denim, high rise, straight leg.', price_cents: 16500, original_price_cents: 38000, shipping_class: 'bottoms_denim', measurements: { waist: 35, rise: 29, inseam: 76, leg_opening: 19 } },
  { brand: 'Loro Piana', title: 'Cashmere crewneck', category: 'knitwear', size_label: '44', size_system: 'IT', color: 'Oatmeal', material: '100% cashmere', condition_grade: 'excellent', flaws: [], description_md: 'Baby cashmere, no pilling. Stored folded in tissue.', price_cents: 38000, original_price_cents: 149500, shipping_class: 'outerwear', measurements: { chest: 50, shoulder: 42, sleeve: 62, length: 60 } },
  { brand: 'Manolo Blahnik', title: 'Hangisi satin pumps', category: 'shoes', size_label: '38', size_system: 'EU', color: 'Navy', material: 'Satin, leather sole', condition_grade: 'good', flaws: [{ text: 'Sole wear consistent with a handful of wears; heel tips replaced.' }], description_md: 'The 105 mm Hangisi. Comes with dust bag.', price_cents: 42500, original_price_cents: 99500, shipping_class: 'coats_boots', measurements: { insole: 24.5, heel: 10.5 } },
];

async function api(p, init = {}, token) {
  const headers = { ...(init.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (init.body && typeof init.body === 'string') headers['Content-Type'] = 'application/json';
  const r = await fetch(`${API}/admin${p}`, { ...init, headers });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${p}: ${r.status} ${JSON.stringify(j)}`);
  return j;
}

const { token } = await api('/login', { method: 'POST', body: JSON.stringify({ password: PASSWORD }) });
const folders = fs.existsSync(PHOTOS) ? fs.readdirSync(PHOTOS).filter((d) => fs.statSync(path.join(PHOTOS, d)).isDirectory()).sort() : [];

for (let i = 0; i < DEMO.length; i++) {
  const d = DEMO[i];
  const item = await api('/items', { method: 'POST', body: JSON.stringify(d) }, token);
  console.log('created', item.sku, d.brand, d.title);
  const folder = folders[i] ? path.join(PHOTOS, folders[i]) : null;
  if (folder) {
    for (const fn of fs.readdirSync(folder).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).sort()) {
      const kind = /^studio/i.test(fn) ? 'studio' : /^flaw/i.test(fn) ? 'flaw' : 'actual';
      const bytes = fs.readFileSync(path.join(folder, fn));
      const meta = await api('/photos', { method: 'POST', body: JSON.stringify({ item_id: item.id, kind, width: 1136, height: 1408, alt: `${d.brand} ${d.title}` }) }, token);
      const type = /\.png$/i.test(fn) ? 'image/png' : /\.webp$/i.test(fn) ? 'image/webp' : 'image/jpeg';
      for (const v of ['_1600.webp', '_1000.webp', '_480.webp', '_1600.jpg']) {
        const r = await fetch(`${API}/admin/photos/${meta.id}/variant/${v}`, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': type }, body: bytes });
        if (!r.ok) throw new Error(`upload ${v} ${r.status}`);
      }
      await api(`/photos/${meta.id}/complete`, { method: 'POST' }, token);
      console.log('  photo', fn, kind);
    }
    try {
      await api(`/items/${item.id}/publish`, { method: 'POST' }, token);
      console.log('  published');
    } catch (e) {
      console.log('  left as draft:', e.message);
    }
  } else {
    console.log('  no photos folder → left as draft');
  }
}
console.log('seed complete');
