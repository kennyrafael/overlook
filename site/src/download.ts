// Points the download buttons at the latest installers, read from the update feeds (the same
// latest.yml / latest-arm64.yml / latest-linux.yml / latest-linux-arm64.yml the app uses), served from R2 by
// the overlook-downloads Worker
// (workers/downloads/, which allows this site via CORS). If a feed cannot be read, the buttons keep
// their fallback link.
export const DOWNLOADS = 'https://overlook-downloads.kennyrafael-cg.workers.dev/overlook';

export interface Feed {
  version?: string;
  path?: string;
  size?: number;
  released?: Date;
}

/** Reads `version`, `path`, `releaseDate` and the first file's `size` from an electron-builder feed. */
export function parseFeed(text: string): Feed {
  const get = (key: string) => text.match(new RegExp(`^${key}:\\s*'?([^'\\n\\r]+?)'?\\s*$`, 'm'))?.[1];
  const size = Number(text.match(/^\s+size:\s*(\d+)/m)?.[1]);
  const released = new Date(get('releaseDate') ?? '');
  return {
    version: get('version'),
    path: get('path'),
    size: Number.isFinite(size) ? size : undefined,
    released: Number.isNaN(released.getTime()) ? undefined : released,
  };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "19 Nov 2026" (UTC, so every visitor sees the same date). */
export const releaseLabel = (d: Date) => `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;

/** Every file a feed lists (`files:` → `- url:` with its `size:`). The Linux feeds list the AppImage and the .deb. */
export function feedFiles(text: string): { url: string; size?: number }[] {
  const files: { url: string; size?: number }[] = [];
  for (const line of text.split(/\r?\n/)) {
    const url = line.match(/^\s*-\s*url:\s*'?([^']+?)'?\s*$/)?.[1];
    if (url) { files.push({ url }); continue; }
    const size = line.match(/^\s+size:\s*(\d+)\s*$/)?.[1];
    const last = files.at(-1);
    if (size && last && last.size === undefined) last.size = Number(size);
  }
  return files;
}

/** Only plain installer names are linked, so a tampered feed cannot point the button elsewhere. */
export const isInstallerName = (path: string | undefined): path is string => !!path && /^[\w.-]+\.exe$/.test(path);
export const isLinuxPackageName = (path: string | undefined): path is string => !!path && /^[\w.-]+\.(AppImage|deb)$/.test(path);
export const isVersion = (v: string | undefined): v is string => !!v && /^[\w.-]+$/.test(v);

export const megabytes = (bytes: number) => `${Math.round(bytes / 1048576)} MB`;

export interface NavLike { userAgentData?: { platform?: string }; platform?: string; userAgent?: string }

/** True when the visitor is on a Mac, so the Apple silicon build becomes the main button. */
export function isMac(nav: NavLike): boolean {
  return /mac/i.test(nav.userAgentData?.platform ?? nav.platform ?? '');
}

/** True on desktop Linux (Android reports a Linux platform too), so the AppImage becomes the main button. */
export function isLinux(nav: NavLike): boolean {
  const platform = nav.userAgentData?.platform ?? nav.platform ?? '';
  return /linux/i.test(platform) && !/android/i.test(`${platform} ${nav.userAgent ?? ''}`);
}

export type Fetch = (url: string, init?: RequestInit) => Promise<Pick<Response, 'ok' | 'text' | 'headers'>>;

/** Wires the download buttons in `doc`. Every failure leaves the button's fallback link in place. */
export async function initDownloads(doc: Document, fetchFn: Fetch, nav: NavLike): Promise<void> {
  const byId = (id: string) => doc.getElementById(id);
  const addSize = (id: string, bytes: number | undefined) => {
    const sub = byId(id);
    if (sub && bytes) sub.textContent = `${sub.textContent} · ${megabytes(bytes)}`;
  };

  const mac = isMac(nav);
  const linux = !mac && isLinux(nav);
  if (mac || linux) {
    byId('dl-x64')?.classList.remove('primary');
    byId(mac ? 'dl-mac-arm64' : 'dl-linux-appimage')?.classList.add('primary');
  }
  // The Linux feeds are read alongside the Windows ones.
  const linuxFeeds = (['x64', 'arm64'] as const).map(async (arch) => {
    try {
      const res = await fetchFn(`${DOWNLOADS}/${arch === 'arm64' ? 'latest-linux-arm64.yml' : 'latest-linux.yml'}`, { cache: 'no-cache' });
      if (!res.ok) return null;
      const text = await res.text();
      return { arch, feed: parseFeed(text), files: feedFiles(text) };
    } catch { return null; }
  });
  /** Installers found, by button id. */
  const found: Record<string, { href: string; bytes?: number }> = {};

  let version = '';
  let released: Date | undefined;
  for (const [arch, feed] of [['x64', 'latest.yml'], ['arm64', 'latest-arm64.yml']] as const) {
    try {
      const res = await fetchFn(`${DOWNLOADS}/${feed}`, { cache: 'no-cache' });
      if (!res.ok) continue;
      const f = parseFeed(await res.text());
      if (!isInstallerName(f.path)) continue;
      const href = `${DOWNLOADS}/${encodeURIComponent(f.path)}`;
      const btn = byId(`dl-${arch}`) as HTMLAnchorElement | null;
      if (btn) btn.href = href;
      addSize(`dl-${arch}-sub`, f.size);
      found[`dl-${arch}`] = { href, bytes: f.size };
      version ||= f.version ?? '';
      released ??= f.released;
    } catch { /* keep the fallback link */ }
  }

  // Linux: a button is enabled only when its file is listed in the feed (a release uploads the files
  // before the feed). The arm64 links sit in a line that stays hidden until one of them exists.
  for (const result of await Promise.all(linuxFeeds)) {
    if (!result) continue;
    for (const kind of ['AppImage', 'deb'] as const) {
      const file = result.files.find((f) => isLinuxPackageName(f.url) && f.url.endsWith(`.${kind}`));
      if (!file) continue;
      const id = `dl-linux${result.arch === 'arm64' ? '-arm64' : ''}-${kind.toLowerCase()}`;
      const btn = byId(id) as HTMLAnchorElement | null;
      if (!btn) continue;
      const href = `${DOWNLOADS}/${encodeURIComponent(file.url)}`;
      btn.href = href;
      btn.removeAttribute('aria-disabled');
      addSize(`${id}-sub`, file.size);
      found[id] = { href, bytes: file.size };
      const line = result.arch === 'arm64' ? byId('dl-linux-arm64') : null;
      if (line) line.hidden = false;
    }
    if (result.arch === 'x64') {
      version ||= result.feed.version ?? '';
      released ??= result.feed.released;
    }
  }

  if (isVersion(version)) {
    const when = released ? releaseLabel(released) : '';
    const label = byId('dl-version');
    if (label) label.textContent = `Latest: v${version}${when ? `, released ${when}` : ''}.`;
    // Trust strip: "v0.2.1 · 19 Nov 2026"
    const strip = byId('dl-release');
    if (strip) strip.textContent = [`v${version}`, when].filter(Boolean).join(' · ');

    // macOS: the release ships Overlook-<version>-<arch>.dmg next to the Windows feeds. A button is
    // enabled only once its file exists (older releases had no macOS build).
    for (const arch of ['arm64', 'x64'] as const) {
      const url = `${DOWNLOADS}/Overlook-${version}-${arch}.dmg`;
      try {
        const res = await fetchFn(url, { method: 'HEAD', cache: 'no-cache' });
        if (!res.ok) continue;
        const btn = byId(`dl-mac-${arch}`) as HTMLAnchorElement | null;
        if (!btn) continue;
        const bytes = Number(res.headers.get('content-length')) || undefined;
        btn.href = url;
        btn.removeAttribute('aria-disabled');
        addSize(`dl-mac-${arch}-sub`, bytes);
        found[`dl-mac-${arch}`] = { href: url, bytes };
      } catch { /* leave it disabled */ }
    }
  }

  // The hero's main button: the installer for the visitor's system (Apple silicon on a Mac, since
  // the browser cannot tell the chips apart reliably; the x86_64 AppImage on Linux, which runs on any
  // distribution; x64 on Windows), else the full download list.
  const main = byId('dl-main') as HTMLAnchorElement | null;
  if (!main) return;
  const pick = found[mac ? 'dl-mac-arm64' : linux ? 'dl-linux-appimage' : 'dl-x64'];
  const mainLabel = byId('dl-main-label');
  const mainSub = byId('dl-main-sub');
  if (mainLabel) mainLabel.textContent = mac ? 'Download for Mac' : linux ? 'Download for Linux' : 'Download for Windows';
  if (!pick) {
    if (mainSub && (mac || linux)) mainSub.textContent = mac ? 'Apple silicon and Intel' : 'AppImage and .deb';
    return;
  }
  main.href = pick.href;
  if (mainSub) mainSub.textContent = [mac ? 'Apple silicon' : linux ? 'AppImage' : 'Free', isVersion(version) ? `v${version}` : '', pick.bytes ? megabytes(pick.bytes) : ''].filter(Boolean).join(' · ');
}
