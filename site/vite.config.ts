import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';

// The security headers Vercel sends (vercel.json), also sent by `vite preview`, so CSP problems show
// up locally before a deploy.
const vercel = JSON.parse(readFileSync(new URL('./vercel.json', import.meta.url), 'utf8')) as {
  headers: { source: string; headers: { key: string; value: string }[] }[];
};
const siteHeaders = Object.fromEntries(vercel.headers.find((h) => h.source === '/(.*)')!.headers.map((h) => [h.key, h.value]));

/**
 * Faster first paint: the stylesheet is inlined into index.html (one round trip less before the hero
 * can render; the CSP allows inline styles) and the Inter font is preloaded so it downloads in parallel.
 */
function criticalPath(): Plugin {
  return {
    name: 'overlook-critical-path',
    apply: 'build',
    enforce: 'post',
    generateBundle(_, bundle) {
      const html = bundle['index.html'];
      if (!html || html.type !== 'asset') return;
      let source = String(html.source);
      for (const [name, file] of Object.entries(bundle)) {
        if (file.type !== 'asset') continue;
        if (name.endsWith('.css')) {
          const tag = new RegExp(`<link rel="stylesheet"[^>]*href="/${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>`);
          if (!tag.test(source)) continue;
          // Vite writes asset URLs in the CSS as absolute paths (base '/'), so the CSS works unchanged
          // inside the page. Fail loudly if that ever stops being true.
          const css = String(file.source);
          const withoutDataUris = css.replace(/url\(\s*"data:[^"]*"\s*\)|url\(\s*'data:[^']*'\s*\)/g, '');
          if (/url\(\s*['"]?(?!data:|\/|https?:|#)/.test(withoutDataUris)) throw new Error('Relative url() in CSS; inlining would break it');
          source = source.replace(tag, () => `<style>${css}</style>`);
          delete bundle[name];
        } else if (/inter-latin-wght-normal-[\w-]+\.woff2$/.test(name)) {
          source = source.replace('</title>', `</title>\n<link rel="preload" href="/${name}" as="font" type="font/woff2" crossorigin>`);
        }
      }
      html.source = source;
    },
  };
}

// Static landing page: Vite bundles src/ and copies public/ into dist/ for Vercel.
export default defineConfig({
  plugins: [criticalPath()],
  build: {
    outDir: 'dist',
    target: 'es2022',
    // Keep the module preload polyfill out: every supported browser has it, and the CSP allows no inline script.
    modulePreload: { polyfill: false },
    assetsInlineLimit: 0,
  },
  preview: { headers: siteHeaders },
});
