// Admin auth: PBKDF2 password hash + HMAC-signed stateless bearer tokens.
// Hash format: pbkdf2$<iterations>$<salt b64url>$<hash b64url>

import { base64url, fromBase64url, timingSafeEqual } from './ids';

const enc = new TextEncoder();

export async function hashPassword(password: string, iterations = 310_000): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, iterations);
  return `pbkdf2$${iterations}$${base64url(salt)}$${base64url(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = Number(parts[1]);
  const salt = fromBase64url(parts[2]);
  const hash = await pbkdf2(password, salt, iterations);
  return timingSafeEqual(base64url(hash), parts[3]);
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    key,
    256,
  );
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

export async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Token = base64url(json{exp,n}) + "." + hmac */
export async function issueToken(secret: string, ttlSeconds = 24 * 3600): Promise<{ token: string; exp: number }> {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const nonce = base64url(crypto.getRandomValues(new Uint8Array(12)));
  const body = base64url(enc.encode(JSON.stringify({ exp, n: nonce })));
  const sig = await hmacHex(secret, body);
  return { token: `${body}.${sig}`, exp };
}

export async function verifyToken(secret: string, token: string | undefined): Promise<{ exp: number } | null> {
  if (!token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = await hmacHex(secret, body);
  if (!timingSafeEqual(expected, sig)) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(fromBase64url(body))) as { exp: number };
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return { exp: payload.exp };
  } catch {
    return null;
  }
}

// ---- symmetric encryption for stored marketplace credentials (AES-GCM) ----

async function aesKey(secretB64: string): Promise<CryptoKey> {
  const raw = fromBase64url(secretB64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''));
  const bytes = raw.length >= 32 ? raw.slice(0, 32) : new Uint8Array(await crypto.subtle.digest('SHA-256', raw as BufferSource));
  return crypto.subtle.importKey('raw', bytes as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptString(secret: string, plain: string): Promise<string> {
  const key = await aesKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plain));
  return `${base64url(iv)}.${base64url(ct)}`;
}

export async function decryptString(secret: string, packed: string): Promise<string> {
  const [ivB, ctB] = packed.split('.');
  const key = await aesKey(secret);
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64url(ivB) as BufferSource },
    key,
    fromBase64url(ctB) as BufferSource,
  );
  return new TextDecoder().decode(pt);
}
