import type { NextFunction, Request, Response } from 'express';

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
export const CLIENT_HEADER = 'x-cpd-client';

/**
 * The server binds to 127.0.0.1, but a web page in the user's browser can still
 * send requests to it. This blocks:
 * - DNS rebinding (Host must be localhost),
 * - cross-site requests from other origins (Origin, when sent, must be local),
 * - cross-site "simple" POSTs (state-changing requests must carry a custom
 *   header, which browsers only allow after a CORS preflight we reject).
 */
export function localOnly(req: Request, res: Response, next: NextFunction) {
  const host = req.headers.host ?? '';
  if (!LOCAL_HOST.test(host)) {
    res.status(403).json({ statusCode: 403, message: 'Forbidden host' });
    return;
  }
  const origin = req.headers.origin;
  if (origin && !LOCAL_ORIGIN.test(origin)) {
    res.status(403).json({ statusCode: 403, message: 'Forbidden origin' });
    return;
  }
  const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  if (mutating && req.path.startsWith('/api/') && req.headers[CLIENT_HEADER] !== '1') {
    res.status(403).json({ statusCode: 403, message: `Missing ${CLIENT_HEADER} header` });
    return;
  }
  next();
}
