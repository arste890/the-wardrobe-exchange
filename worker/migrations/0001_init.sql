-- The Wardrobe Exchange — initial schema. Timestamps are unix seconds (INTEGER).

CREATE TABLE items (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  sku TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','available','reserved','sold','archived')),
  title TEXT NOT NULL DEFAULT '',
  brand TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'tops',
  subcategory TEXT,
  size_label TEXT NOT NULL DEFAULT '',
  size_system TEXT,
  color TEXT,
  material TEXT,
  condition_grade TEXT NOT NULL DEFAULT 'very_good'
    CHECK (condition_grade IN ('new_with_tags','excellent','very_good','good','fair')),
  condition_notes TEXT,
  flaws_json TEXT NOT NULL DEFAULT '[]',
  measurements_json TEXT NOT NULL DEFAULT '{}',
  description_md TEXT NOT NULL DEFAULT '',
  price_cents INTEGER NOT NULL DEFAULT 0,
  original_price_cents INTEGER,
  shipping_class TEXT NOT NULL DEFAULT 'tops'
    CHECK (shipping_class IN ('tops','bottoms_denim','outerwear','coats_boots')),
  tax_code TEXT NOT NULL DEFAULT 'txcd_30011000',
  reserved_until INTEGER,
  reservation_id TEXT,
  sold_at INTEGER,
  sold_channel TEXT,
  published_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_items_status ON items(status);
CREATE INDEX idx_items_category_status ON items(category, status);
CREATE INDEX idx_items_brand ON items(brand);

CREATE TABLE photos (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('studio','actual','flaw')),
  sort INTEGER NOT NULL DEFAULT 0,
  r2_key_base TEXT NOT NULL,
  width INTEGER NOT NULL DEFAULT 0,
  height INTEGER NOT NULL DEFAULT 0,
  alt TEXT NOT NULL DEFAULT '',
  is_cover INTEGER NOT NULL DEFAULT 0,
  ready INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_photos_item_sort ON photos(item_id, sort);

CREATE TABLE reservations (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES items(id),
  stripe_session_id TEXT,
  expires_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'held'
    CHECK (status IN ('held','converted','released','expired')),
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_reservations_expiry ON reservations(expires_at, status);

CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES items(id),
  channel TEXT NOT NULL,
  external_id TEXT NOT NULL,
  stripe_payment_intent TEXT,
  buyer_email TEXT,
  buyer_name TEXT,
  ship_to_json TEXT,
  subtotal_cents INTEGER NOT NULL DEFAULT 0,
  shipping_cents INTEGER NOT NULL DEFAULT 0,
  tax_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'paid'
    CHECK (status IN ('paid','shipped','refunded','disputed')),
  tracking_carrier TEXT,
  tracking_number TEXT,
  shipped_at INTEGER,
  policy_version TEXT,
  notes TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (channel, external_id)
);
CREATE INDEX idx_orders_status ON orders(status);

CREATE TABLE channel_listings (
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  external_sku TEXT,
  external_offer_id TEXT,
  external_listing_id TEXT,
  listing_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','listed','ended','error')),
  last_error TEXT,
  last_synced_at INTEGER,
  PRIMARY KEY (item_id, channel)
);

CREATE TABLE channel_credentials (
  channel TEXT PRIMARY KEY,
  refresh_token_enc TEXT,
  access_token TEXT,
  access_expires_at INTEGER,
  meta_json TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL
);

CREATE TABLE stripe_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  received_at INTEGER NOT NULL
);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  ts INTEGER NOT NULL,
  actor TEXT NOT NULL,
  kind TEXT NOT NULL,
  item_id TEXT,
  order_id TEXT,
  payload_json TEXT
);
CREATE INDEX idx_events_item ON events(item_id, ts);
CREATE INDEX idx_events_ts ON events(ts);

CREATE TABLE login_attempts (
  ip TEXT NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX idx_login_attempts ON login_attempts(ip, ts);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
