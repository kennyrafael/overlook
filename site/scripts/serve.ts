// Serves the built site (dist/) on 127.0.0.1 with the headers Vercel sends (vercel.json, including the
// CSP and asset caching), for Lighthouse and manual checks. `vite preview` also works, but this has no
// dependencies and matches production headers exactly.
//   npm run build && npm run serve [-- port]
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, '..', 'dist');
const port = Number(process.argv[2] ?? process.env.PORT ?? 4180);
const vercel = JSON.parse(readFileSync(join(here, '..', 'vercel.json'), 'utf8')) as { headers: { source: string; headers: { key: string; value: string }[] }[] };
const site = Object.fromEntries(vercel.headers[0].headers.map((h) => [h.key, h.value]));
const assets = Object.fromEntries((vercel.headers.find((h) => h.source.startsWith('/assets'))?.headers ?? []).map((h) => [h.key, h.value]));
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.avif': 'image/avif', '.webp': 'image/webp', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml',
};

createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
  let file = normalize(join(dist, path));
  if (!file.startsWith(dist)) { res.writeHead(400).end(); return; }
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) { res.writeHead(404, site).end('not found'); return; }
  res.writeHead(200, { ...site, ...(path.startsWith('/assets/') ? assets : {}), 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
}).listen(port, '127.0.0.1', () => console.log(`Serving dist/ at http://127.0.0.1:${port}/`));
