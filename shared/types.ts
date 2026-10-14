// Shared data shapes used by both the Astro site and the Cloudflare Worker.

export type ItemStatus = 'draft' | 'available' | 'reserved' | 'sold' | 'archived';

export type ConditionGrade =
  | 'new_with_tags'
  | 'excellent'
  | 'very_good'
  | 'good'
  | 'fair';

export const CONDITION_LABELS: Record<ConditionGrade, string> = {
  new_with_tags: 'New with tags',
  excellent: 'Excellent',
  very_good: 'Very good',
  good: 'Good',
  fair: 'Fair',
};

export const CONDITION_DESCRIPTIONS: Record<ConditionGrade, string> = {
  new_with_tags: 'Unworn, original tags attached.',
  excellent: 'Worn once or twice at most. No visible flaws.',
  very_good: 'Gently worn. Minor signs of wear only visible up close; every flaw is photographed.',
  good: 'Worn and cared for. Noticeable wear described and photographed; no structural issues.',
  fair: 'Well loved. Visible wear or a repaired flaw; priced accordingly.',
};

export type Category =
  | 'outerwear'
  | 'tops'
  | 'knitwear'
  | 'dresses'
  | 'bottoms'
  | 'denim'
  | 'shoes'
  | 'bags'
  | 'accessories';

export const CATEGORY_LABELS: Record<Category, string> = {
  outerwear: 'Outerwear',
  tops: 'Tops',
  knitwear: 'Knitwear',
  dresses: 'Dresses',
  bottoms: 'Bottoms',
  denim: 'Denim',
  shoes: 'Shoes',
  bags: 'Bags',
  accessories: 'Accessories',
};

export type ShippingClass = 'tops' | 'bottoms_denim' | 'outerwear' | 'coats_boots';

export type PhotoKind = 'studio' | 'actual' | 'flaw';

export interface Photo {
  id: string;
  item_id: string;
  kind: PhotoKind;
  sort: number;
  /** R2 key without the variant suffix, e.g. items/01H.../01H... */
  r2_key_base: string;
  width: number;
  height: number;
  alt: string;
  is_cover: boolean;
}

/** URLs for one photo at each generated size. */
export interface PhotoSrc {
  id: string;
  kind: PhotoKind;
  alt: string;
  width: number;
  height: number;
  is_cover: boolean;
  /** 1600px WebP */
  large: string;
  /** 1000px WebP */
  medium: string;
  /** 480px WebP */
  small: string;
  /** 1600px JPEG — for OG tags, feeds, eBay */
  jpg: string;
}

export interface Measurements {
  [key: string]: number | undefined;
}

export interface Flaw {
  text: string;
  photo_id?: string;
}

export interface Item {
  id: string;
  slug: string;
  sku: string;
  status: ItemStatus;
  title: string;
  brand: string;
  category: Category;
  subcategory: string | null;
  size_label: string;
  size_system: string | null;
  color: string | null;
  material: string | null;
  condition_grade: ConditionGrade;
  condition_notes: string | null;
  flaws: Flaw[];
  measurements: Measurements;
  description_md: string;
  price_cents: number;
  original_price_cents: number | null;
  shipping_class: ShippingClass;
  tax_code: string;
  reserved_until: number | null;
  sold_at: number | null;
  sold_channel: string | null;
  published_at: number | null;
  created_at: number;
  updated_at: number;
}

/** What the public catalog API returns per item. */
export interface CatalogItem extends Omit<Item, 'reserved_until'> {
  photos: PhotoSrc[];
  cover: PhotoSrc | null;
  shipping_cents: number;
  url: string;
}

export interface Catalog {
  generated_at: number;
  site_url: string;
  items: CatalogItem[];
}

export interface Availability {
  status: ItemStatus;
  reserved_until: number | null;
}

export type OrderStatus = 'paid' | 'shipped' | 'refunded' | 'disputed';

export interface ShipTo {
  name: string;
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  postal_code: string;
  country: string;
}

export interface Order {
  id: string;
  item_id: string;
  channel: 'site' | 'ebay' | string;
  external_id: string;
  stripe_payment_intent: string | null;
  buyer_email: string | null;
  buyer_name: string | null;
  ship_to: ShipTo | null;
  subtotal_cents: number;
  shipping_cents: number;
  tax_cents: number;
  total_cents: number;
  status: OrderStatus;
  tracking_carrier: string | null;
  tracking_number: string | null;
  shipped_at: number | null;
  policy_version: string | null;
  created_at: number;
}

export type ChannelListingStatus = 'pending' | 'listed' | 'ended' | 'error';

export interface ChannelListing {
  item_id: string;
  channel: string;
  external_sku: string | null;
  external_offer_id: string | null;
  external_listing_id: string | null;
  listing_url: string | null;
  status: ChannelListingStatus;
  last_error: string | null;
  last_synced_at: number | null;
}

/** Measurement fields the admin form shows per category (cm). */
export const MEASUREMENT_FIELDS: Record<Category, { key: string; label: string }[]> = {
  outerwear: [
    { key: 'chest', label: 'Chest (pit to pit)' },
    { key: 'shoulder', label: 'Shoulder to shoulder' },
    { key: 'sleeve', label: 'Sleeve' },
    { key: 'length', label: 'Length (collar to hem)' },
  ],
  tops: [
    { key: 'chest', label: 'Chest (pit to pit)' },
    { key: 'shoulder', label: 'Shoulder to shoulder' },
    { key: 'sleeve', label: 'Sleeve' },
    { key: 'length', label: 'Length' },
  ],
  knitwear: [
    { key: 'chest', label: 'Chest (pit to pit)' },
    { key: 'shoulder', label: 'Shoulder to shoulder' },
    { key: 'sleeve', label: 'Sleeve' },
    { key: 'length', label: 'Length' },
  ],
  dresses: [
    { key: 'chest', label: 'Chest (pit to pit)' },
    { key: 'waist', label: 'Waist' },
    { key: 'hips', label: 'Hips' },
    { key: 'length', label: 'Length' },
  ],
  bottoms: [
    { key: 'waist', label: 'Waist (flat)' },
    { key: 'rise', label: 'Front rise' },
    { key: 'inseam', label: 'Inseam' },
    { key: 'leg_opening', label: 'Leg opening' },
  ],
  denim: [
    { key: 'waist', label: 'Waist (flat)' },
    { key: 'rise', label: 'Front rise' },
    { key: 'inseam', label: 'Inseam' },
    { key: 'leg_opening', label: 'Leg opening' },
  ],
  shoes: [
    { key: 'insole', label: 'Insole length' },
    { key: 'heel', label: 'Heel height' },
  ],
  bags: [
    { key: 'width', label: 'Width' },
    { key: 'height', label: 'Height' },
    { key: 'depth', label: 'Depth' },
    { key: 'strap_drop', label: 'Strap drop' },
  ],
  accessories: [
    { key: 'length', label: 'Length' },
    { key: 'width', label: 'Width' },
  ],
};

export const MEASUREMENT_LABELS: Record<string, string> = Object.values(MEASUREMENT_FIELDS)
  .flat()
  .reduce<Record<string, string>>((acc, f) => ((acc[f.key] = f.label), acc), {});
