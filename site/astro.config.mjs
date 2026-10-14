import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { fileURLToPath } from 'node:url';

// PUBLIC_SITE_URL: canonical origin (https://thewardrobeexchange.shop or https://arste890.github.io)
// GITHUB_PAGES_BASE: "/the-wardrobe-exchange" while on github.io, "/" on the custom domain
const site = process.env.PUBLIC_SITE_URL || 'http://localhost:4321';
const base = process.env.GITHUB_PAGES_BASE || '/';

export default defineConfig({
  site,
  base,
  output: 'static',
  trailingSlash: 'ignore',
  build: { format: 'directory' },
  integrations: [
    sitemap({
      filter: (page) => !page.includes('/admin') && !page.includes('/success') && !page.includes('/cancel') && !page.includes('/wishlist'),
    }),
  ],
  vite: {
    resolve: { alias: { '@kw/shared': fileURLToPath(new URL('../shared', import.meta.url)) } },
  },
});
