// Points the download buttons at the latest installers, read from the update feeds (the same
// latest.yml / latest-arm64.yml the app uses), served from R2 by the overlook-downloads Worker
// (workers/downloads/, which allows this site via CORS). If a feed cannot be read, the buttons keep
// their fallback link.
export const DOWNLOADS = 'https://overlook-downloads.kennyrafael-cg.workers.dev/overlook';

export interface Feed {
  version?: string;
  path?: string;
  size?: number;
}

/** Reads `version`, `path` and the first file's `size` from an electron-builder feed. */
export function parseFeed(text: string): Feed {
  const get = (key: string) => text.match(new RegExp(`^${key}:\\s*'?([^'\\n\\r]+?)'?\\s*$`, 'm'))?.[1];
  const size = Number(text.match(/^\s+size:\s*(\d+)/m)?.[1]);
  return { version: get('version'), path: get('path'), size: Number.isFinite(size) ? size : undefined };
}

/** Only plain installer names are linked, so a tampered feed cannot point the button elsewhere. */
export const isInstallerName = (path: string | undefined): path is string => !!path && /^[\w.-]+\.exe$/.test(path);
export const isVersion = (v: string | undefined): v is string => !!v && /^[\w.-]+$/.test(v);

export const megabytes = (bytes: number) => `${Math.round(bytes / 1048576)} MB`;

/** True when the visitor is on a Mac, so the Apple silicon build becomes the main button. */
export function isMac(nav: { userAgentData?: { platform?: string }; platform?: string }): boolean {
  return /mac/i.test(nav.userAgentData?.platform ?? nav.platform ?? '');
}

export type Fetch = (url: string, init?: RequestInit) => Promise<Pick<Response, 'ok' | 'text' | 'headers'>>;

/** Wires the download buttons in `doc`. Every failure leaves the button's fallback link in place. */
export async function initDownloads(doc: Document, fetchFn: Fetch, nav: Parameters<typeof isMac>[0]): Promise<void> {
  const byId = (id: string) => doc.getElementById(id);
  const addSize = (id: string, bytes: number | undefined) => {
    const sub = byId(id);
    if (sub && bytes) sub.textContent = `${sub.textContent} · ${megabytes(bytes)}`;
  };

  if (isMac(nav)) {
    byId('dl-x64')?.classList.remove('primary');
    byId('dl-mac-arm64')?.classList.add('primary');
  }

  let version = '';
  for (const [arch, feed] of [['x64', 'latest.yml'], ['arm64', 'latest-arm64.yml']] as const) {
    try {
      const res = await fetchFn(`${DOWNLOADS}/${feed}`, { cache: 'no-cache' });
      if (!res.ok) continue;
      const f = parseFeed(await res.text());
      if (!isInstallerName(f.path)) continue;
      const btn = byId(`dl-${arch}`) as HTMLAnchorElement | null;
      if (btn) btn.href = `${DOWNLOADS}/${encodeURIComponent(f.path)}`;
      addSize(`dl-${arch}-sub`, f.size);
      version ||= f.version ?? '';
    } catch { /* keep the fallback link */ }
  }
  if (!isVersion(version)) return;
  const label = byId('dl-version');
  if (label) label.textContent = `Latest: v${version}.`;

  // macOS: the release ships Overlook-<version>-<arch>.dmg next to the Windows feeds. A button is
  // enabled only once its file exists (older releases had no macOS build).
  for (const arch of ['arm64', 'x64'] as const) {
    const url = `${DOWNLOADS}/Overlook-${version}-${arch}.dmg`;
    try {
      const res = await fetchFn(url, { method: 'HEAD', cache: 'no-cache' });
      if (!res.ok) continue;
      const btn = byId(`dl-mac-${arch}`) as HTMLAnchorElement | null;
      if (!btn) continue;
      btn.href = url;
      btn.removeAttribute('aria-disabled');
      addSize(`dl-mac-${arch}-sub`, Number(res.headers.get('content-length')) || undefined);
    } catch { /* leave it disabled */ }
  }
}
