import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

// The security headers Vercel sends (vercel.json), also sent by `vite preview`, so CSP problems show
// up locally before a deploy.
const vercel = JSON.parse(readFileSync(new URL('./vercel.json', import.meta.url), 'utf8')) as {
  headers: { source: string; headers: { key: string; value: string }[] }[];
};
const siteHeaders = Object.fromEntries(vercel.headers.find((h) => h.source === '/(.*)')!.headers.map((h) => [h.key, h.value]));

// Static landing page: Vite bundles src/ and copies public/ into dist/ for Vercel.
export default defineConfig({
  build: {
    outDir: 'dist',
    target: 'es2022',
    // Keep the module preload polyfill out: every supported browser has it, and the CSP allows no inline script.
    modulePreload: { polyfill: false },
    assetsInlineLimit: 0,
  },
  preview: { headers: siteHeaders },
});
