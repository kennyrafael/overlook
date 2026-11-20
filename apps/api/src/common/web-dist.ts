import type { NextFunction, Request, Response } from 'express';
import { join } from 'path';

/** Built UI. The desktop app can point elsewhere with CPD_WEB_DIST. */
export const webDist = process.env.CPD_WEB_DIST ?? join(__dirname, '..', '..', '..', 'web', 'dist');

/**
 * Deep links (/projects/abc, /claude/sessions/…) get the UI's index.html.
 *
 * Not ServeStaticModule's own fallback: it calls `res.sendFile(absolutePath)` without a root, and Express then
 * refuses any path with a dot-folder in it (`send` treats every segment as a possible dotfile). Overlook often
 * lives under one: a Linux AppImage runs from /tmp/.mount_*, checkouts sit in .claude/worktrees. With `root`,
 * only the file name is checked.
 */
export function spaFallback(root: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const last = req.path.split('/').pop() ?? '';
    // Only page routes: GET/HEAD, not the API, and no file extension (assets are served by the static handler).
    if ((req.method !== 'GET' && req.method !== 'HEAD') || req.path === '/api' || req.path.startsWith('/api/') || last.includes('.')) return next();
    res.sendFile('index.html', { root }, (err) => { if (err) next(); });
  };
}
