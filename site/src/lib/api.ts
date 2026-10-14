// Build-time catalog fetch + URL helpers shared by pages.

import type { Catalog, CatalogItem } from '@kw/shared/types';

export const API_URL = (import.meta.env.PUBLIC_API_URL || 'http://localhost:8787').replace(/\/$/, '');
export const SITE_URL = (import.meta.env.PUBLIC_SITE_URL || import.meta.env.SITE || 'http://localhost:4321').replace(/\/$/, '');

/** Prefix a site path with Astro's base (e.g. "/the-wardrobe-exchange" on github.io). */
export function url(path: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

let cache: Catalog | null = null;

export async function fetchCatalog(): Promise<Catalog> {
  if (cache) return cache;
  try {
    const res = await fetch(`${API_URL}/api/catalog`);
    if (!res.ok) throw new Error(`catalog ${res.status}`);
    cache = (await res.json()) as Catalog;
  } catch (e) {
    console.warn(`[site] Could not fetch catalog from ${API_URL}: ${(e as Error).message}. Building with an empty catalog.`);
    cache = { generated_at: Math.floor(Date.now() / 1000), site_url: SITE_URL, items: [] };
  }
  return cache;
}

export function liveItems(cat: Catalog): CatalogItem[] {
  return cat.items.filter((i) => i.status === 'available' || i.status === 'reserved');
}

export function similarItems(cat: Catalog, item: CatalogItem, n = 4): CatalogItem[] {
  const pool = cat.items.filter((i) => i.id !== item.id && i.cover);
  const score = (i: CatalogItem) =>
    (i.status === 'available' ? 10 : i.status === 'reserved' ? 5 : 0) +
    (i.category === item.category ? 4 : 0) +
    (i.brand === item.brand ? 3 : 0) +
    (i.size_label === item.size_label ? 2 : 0);
  return pool.sort((a, b) => score(b) - score(a)).slice(0, n);
}
