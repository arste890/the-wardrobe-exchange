#!/usr/bin/env node
// Usage: npm run hash-password -w worker -- "your admin password"
// Prints a value for ADMIN_PASSWORD_HASH (wrangler secret put ADMIN_PASSWORD_HASH).
import { webcrypto as crypto } from 'node:crypto';

const password = process.argv[2];
if (!password) {
  console.error('usage: hash-password <password>');
  process.exit(1);
}
const b64url = (buf) => Buffer.from(buf).toString('base64url');
const iterations = 310_000;
const salt = crypto.getRandomValues(new Uint8Array(16));
const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
console.log(`pbkdf2$${iterations}$${b64url(salt)}$${b64url(bits)}`);
