import { timingSafeEqual } from 'crypto';
import type { NextFunction, Request, Response } from 'express';

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
export const CLIENT_HEADER = 'x-cpd-client';
export const TOKEN_COOKIE = 'cpd_token';

/** Per-launch secret set by the desktop app. When present, every request must carry it. */
const LAUNCH_TOKEN = process.env.CPD_TOKEN ? Buffer.from(process.env.CPD_TOKEN) : null;

function cookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

function hasLaunchToken(req: Request): boolean {
  if (!LAUNCH_TOKEN) return true;
  const given = Buffer.from(cookie(req, TOKEN_COOKIE) ?? '');
  return given.length === LAUNCH_TOKEN.length && timingSafeEqual(given, LAUNCH_TOKEN);
}

/**
 * The server binds to 127.0.0.1, but a web page in the user's browser can still
 * send requests to it. This blocks:
 * - DNS rebinding (Host must be localhost),
 * - cross-site requests from other origins (Origin, when sent, must be local),
 * - cross-site "simple" POSTs (state-changing requests must carry a custom
 *   header, which browsers only allow after a CORS preflight we reject),
 * - in the desktop app, any other local program or browser tab: every request
 *   must carry the per-launch token cookie that only the app window has.
 */
export function localOnly(req: Request, res: Response, next: NextFunction) {
  const host = req.headers.host ?? '';
  if (!LOCAL_HOST.test(host)) {
    res.status(403).json({ statusCode: 403, message: 'Forbidden host' });
    return;
  }
  if (!hasLaunchToken(req)) {
    res.status(403).json({ statusCode: 403, message: 'Missing launch token' });
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
