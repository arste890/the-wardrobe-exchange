import type { Item, Photo, ChannelListing, ShipTo } from '@kw/shared/types';
import type { Env } from '../env';

export interface ListResult {
  external_sku: string;
  external_offer_id: string | null;
  external_listing_id: string | null;
  listing_url: string | null;
}

export interface ExternalSale {
  external_order_id: string;
  external_sku: string;
  buyer_name: string | null;
  buyer_email: string | null;
  ship_to: ShipTo | null;
  subtotal_cents: number;
  shipping_cents: number;
  tax_cents: number;
  total_cents: number;
  paid_at: number;
}

export type DelistReason = 'sold_site' | 'sold_other' | 'archived';

/** One marketplace integration. Implementations must be safe to retry. */
export interface Channel {
  readonly name: string;
  list(env: Env, item: Item, photos: Photo[], photoJpgUrls: string[]): Promise<ListResult>;
  update(env: Env, item: Item, listing: ChannelListing): Promise<void>;
  delist(env: Env, listing: ChannelListing, reason: DelistReason): Promise<void>;
  pollSales(env: Env, sinceUnix: number): Promise<ExternalSale[]>;
  healthcheck(env: Env): Promise<{ ok: boolean; detail: string }>;
}
