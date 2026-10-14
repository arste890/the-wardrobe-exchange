export interface Env {
  DB: D1Database;
  PHOTOS: R2Bucket;

  // vars (wrangler.toml)
  PUBLIC_SITE_URL: string;
  ALLOWED_ORIGINS: string;
  CHANNELS: string;
  GITHUB_REPO: string;

  // secrets
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  ADMIN_PASSWORD_HASH: string;
  SESSION_SECRET: string;
  CRED_KEY: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  SELLER_EMAIL: string;
  GITHUB_TOKEN?: string;
  EBAY_ENV?: 'sandbox' | 'production';
  EBAY_CLIENT_ID?: string;
  EBAY_CLIENT_SECRET?: string;
  EBAY_RU_NAME?: string;
}

export type AppContext = {
  Bindings: Env;
  Variables: { adminSession?: { exp: number } };
};

export const now = () => Math.floor(Date.now() / 1000);

export function allowedOrigins(env: Env): string[] {
  return (env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
