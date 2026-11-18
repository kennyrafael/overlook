// Overlook downloads: serves overlook/* from the R2 bucket (installers, blockmaps, update feeds).
// Supports Range requests (electron-updater downloads only the changed blocks of an update) and
// conditional requests. CORS allows the landing page to read the feeds.
const ALLOWED_ORIGIN = 'https://overlook.agenthub.pt';

export default {
  async fetch(req, env) {
    const cors = { 'Access-Control-Allow-Origin': ALLOWED_ORIGIN, Vary: 'Origin' };
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'GET, HEAD' } });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });

    let key;
    try { key = decodeURIComponent(new URL(req.url).pathname.slice(1)); } catch { key = ''; }
    if (!/^overlook\/[\w.-]+$/.test(key)) return new Response('Not found', { status: 404, headers: cors });

    const obj = await env.BUCKET.get(key, { range: req.headers, onlyIf: req.headers });
    if (!obj) return new Response('Not found', { status: 404, headers: cors });

    const headers = new Headers(cors);
    obj.writeHttpMetadata(headers);
    headers.set('ETag', obj.httpEtag);
    headers.set('Accept-Ranges', 'bytes');
    if (!('body' in obj)) return new Response(null, { status: 304, headers });

    let status = 200;
    if (obj.range && req.headers.has('range')) {
      const offset = obj.range.offset ?? (obj.range.suffix !== undefined ? obj.size - obj.range.suffix : 0);
      const length = obj.range.length ?? obj.size - offset;
      headers.set('Content-Range', `bytes ${offset}-${offset + length - 1}/${obj.size}`);
      headers.set('Content-Length', String(length));
      status = 206;
    } else {
      headers.set('Content-Length', String(obj.size));
    }
    return new Response(req.method === 'HEAD' ? null : obj.body, { status, headers });
  },
};
