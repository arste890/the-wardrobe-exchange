// Product feeds for Meta Commerce (Instagram/Facebook Shop), Google Merchant Center and Pinterest.

import type { Catalog, CatalogItem, Category } from '@kw/shared/types';
import { CATEGORY_LABELS, CONDITION_LABELS } from '@kw/shared/types';
import { SHIPPING_SERVICE } from '@kw/shared/shipping';
import { BRAND } from '@kw/shared/brand';

const GOOGLE_CATEGORY: Record<Category, string> = {
  outerwear: 'Apparel & Accessories > Clothing > Outerwear > Coats & Jackets',
  tops: 'Apparel & Accessories > Clothing > Shirts & Tops',
  knitwear: 'Apparel & Accessories > Clothing > Shirts & Tops',
  dresses: 'Apparel & Accessories > Clothing > Dresses',
  bottoms: 'Apparel & Accessories > Clothing > Pants',
  denim: 'Apparel & Accessories > Clothing > Pants',
  shoes: 'Apparel & Accessories > Shoes',
  bags: 'Apparel & Accessories > Handbags, Wallets & Cases > Handbags',
  accessories: 'Apparel & Accessories > Clothing Accessories',
};

const THIRTY_DAYS = 30 * 86400;

function feedItems(cat: Catalog): CatalogItem[] {
  const cutoff = cat.generated_at - THIRTY_DAYS;
  return cat.items.filter((i) => i.cover && (i.status !== 'sold' || (i.sold_at ?? 0) > cutoff));
}

function availability(i: CatalogItem): 'in stock' | 'out of stock' {
  return i.status === 'available' ? 'in stock' : 'out of stock';
}

function description(i: CatalogItem): string {
  const flaws = i.flaws.length ? ` Condition notes: ${i.flaws.map((f) => f.text).join('; ')}.` : '';
  return `${i.brand} ${i.title}, size ${i.size_label}. ${CONDITION_LABELS[i.condition_grade]}.${flaws} Pre-owned, one of a kind. ${i.description_md.replace(/[#*_>`\n]+/g, ' ').trim()}`
    .replace(/\s+/g, ' ')
    .slice(0, 4900);
}

function price(i: CatalogItem): string {
  return `${(i.price_cents / 100).toFixed(2)} USD`;
}

function csv(rows: (string | number)[][]): string {
  return rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n') + '\r\n';
}

export function metaFeed(cat: Catalog): string {
  const header = ['id', 'title', 'description', 'availability', 'condition', 'price', 'link', 'image_link', 'additional_image_link', 'brand', 'google_product_category', 'size', 'color', 'material', 'gender', 'product_type', 'inventory'];
  const rows = feedItems(cat).map((i) => [
    i.sku, `${i.brand} ${i.title}`.slice(0, 150), description(i), availability(i), 'used', price(i), i.url, i.cover!.jpg,
    i.photos.filter((p) => p.id !== i.cover!.id && p.kind !== 'flaw').slice(0, 10).map((p) => p.jpg).join(','),
    i.brand, GOOGLE_CATEGORY[i.category], i.size_label, i.color ?? '', i.material ?? '', 'female', CATEGORY_LABELS[i.category], i.status === 'available' ? 1 : 0,
  ]);
  return csv([header, ...rows]);
}

export function pinterestFeed(cat: Catalog): string {
  const header = ['id', 'title', 'description', 'link', 'image_link', 'price', 'availability', 'condition', 'brand', 'google_product_category', 'additional_image_link', 'product_type'];
  const rows = feedItems(cat).map((i) => [
    i.sku, `${i.brand} ${i.title}`.slice(0, 150), description(i), i.url, i.cover!.jpg, price(i), availability(i), 'used', i.brand,
    GOOGLE_CATEGORY[i.category], i.photos.filter((p) => p.id !== i.cover!.id && p.kind !== 'flaw').slice(0, 10).map((p) => p.jpg).join(','), CATEGORY_LABELS[i.category],
  ]);
  return csv([header, ...rows]);
}

const x = (s: string | number | null | undefined) => String(s ?? '').replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!);

export function googleFeed(cat: Catalog): string {
  const items = feedItems(cat)
    .map(
      (i) => `  <item>
    <g:id>${x(i.sku)}</g:id>
    <title>${x(`${i.brand} ${i.title}`.slice(0, 150))}</title>
    <description>${x(description(i))}</description>
    <link>${x(i.url)}</link>
    <g:image_link>${x(i.cover!.jpg)}</g:image_link>
${i.photos.filter((p) => p.id !== i.cover!.id && p.kind !== 'flaw').slice(0, 10).map((p) => `    <g:additional_image_link>${x(p.jpg)}</g:additional_image_link>`).join('\n')}
    <g:availability>${availability(i)}</g:availability>
    <g:price>${x(price(i))}</g:price>
    <g:condition>used</g:condition>
    <g:brand>${x(i.brand)}</g:brand>
    <g:identifier_exists>no</g:identifier_exists>
    <g:google_product_category>${x(GOOGLE_CATEGORY[i.category])}</g:google_product_category>
    <g:product_type>${x(CATEGORY_LABELS[i.category])}</g:product_type>
    <g:size>${x(i.size_label)}</g:size>
    ${i.color ? `<g:color>${x(i.color)}</g:color>` : ''}
    ${i.material ? `<g:material>${x(i.material)}</g:material>` : ''}
    <g:gender>female</g:gender>
    <g:age_group>adult</g:age_group>
    <g:shipping><g:country>US</g:country><g:service>${x(SHIPPING_SERVICE)}</g:service><g:price>${(i.shipping_cents / 100).toFixed(2)} USD</g:price></g:shipping>
    <g:shipping_label>${x(i.shipping_class)}</g:shipping_label>
  </item>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
<channel>
  <title>${x(BRAND.name)}</title>
  <link>${x(cat.site_url)}</link>
  <description>${x(BRAND.description)}</description>
${items}
</channel>
</rss>
`;
}
