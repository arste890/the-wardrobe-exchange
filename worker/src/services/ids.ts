// Dependency-free ULID-style ids (time-sortable, 26 chars, Crockford base32) and slug helpers.

const ENC = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function ulid(nowMs = Date.now()): string {
  let t = nowMs;
  let time = '';
  for (let i = 0; i < 10; i++) {
    time = ENC[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let rand = '';
  for (let i = 0; i < 16; i++) rand += ENC[bytes[i] % 32];
  return time + rand;
}

export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70);
}

/** e.g. "the-row-wool-coat-m-7fq2" */
export function itemSlug(brand: string, title: string, size: string, id: string): string {
  const base = slugify([brand, title, size].filter(Boolean).join(' '));
  return `${base || 'item'}-${id.slice(-4).toLowerCase()}`;
}

/** SKU: KW-YYMM-XXXX (brand short + year/month + random). */
export function makeSku(prefix: string, d = new Date()): string {
  const yy = String(d.getUTCFullYear()).slice(-2);
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const bytes = new Uint8Array(3);
  crypto.getRandomValues(bytes);
  let r = '';
  for (const b of bytes) r += ENC[b % 32];
  return `${prefix}-${yy}${mm}-${r}`;
}

export function randomToken(bytes = 32): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return base64url(b);
}

export function base64url(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const c of u8) s += String.fromCharCode(c);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64url(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const u8 = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) u8[i] = b.charCodeAt(i);
  return u8;
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
