// What a request to the download Worker counts as, for the Analytics Engine dataset `overlook`.
// Pure (no Cloudflare APIs), so it is unit-tested in test/count.test.js.
//
// Counted, one data point each:
//   download         an installer fetched from its first byte (browser, curl, a download manager)
//   update-download  the same, fetched by the app itself (electron-updater, Electron user agent)
//   update-check     an update feed (latest*.yml) read by the app: roughly one per running copy per day
// Not counted: HEAD requests (the site checking that a .dmg exists), the site reading the feeds,
// resumed or partial downloads (a Range that does not start at byte 0), blockmaps, anything else.
//
// Stored: kind, platform, arch, version, file name, country, source (web / app). Never an IP address,
// a user agent or anything that identifies a person.

const INSTALLERS = [
  // Overlook-Setup-0.2.1-x64.exe
  { re: /^Overlook-Setup-(\d[\w.-]*?)-(x64|arm64)\.exe$/, platform: 'windows' },
  // Overlook-0.2.1-arm64.dmg
  { re: /^Overlook-(\d[\w.-]*?)-(x64|arm64)\.dmg$/, platform: 'macos' },
  // Overlook-0.4.0-arm64-mac.zip: the macOS update payload (signed builds), fetched by the app
  { re: /^Overlook-(\d[\w.-]*?)-(x64|arm64)-mac\.zip$/, platform: 'macos' },
  // Linux (electron-builder names): Overlook-0.3.0-x86_64.AppImage, Overlook-0.3.0-amd64.deb, …-arm64 / aarch64
  { re: /^Overlook-(\d[\w.-]*?)-(x86_64|amd64|arm64|aarch64)\.(?:AppImage|deb)$/, platform: 'linux' },
];

const FEEDS = {
  'latest.yml': { platform: 'windows', arch: 'x64' },
  'latest-arm64.yml': { platform: 'windows', arch: 'arm64' },
  'latest-mac.yml': { platform: 'macos', arch: '' },
  'latest-linux.yml': { platform: 'linux', arch: 'x64' },
  'latest-linux-arm64.yml': { platform: 'linux', arch: 'arm64' },
};

const ARCH = { x86_64: 'x64', amd64: 'x64', aarch64: 'arm64' };

/** True when a Range header is absent or starts at byte 0 (a whole download, not a resume). */
export function fromStart(range) {
  if (!range) return true;
  return /^bytes=0-/.test(range.trim());
}

/**
 * @param {{ method: string, file: string, range?: string | null, origin?: string | null, userAgent?: string | null, country?: string | null }} r
 * @param {string} siteOrigin the landing page's origin (its feed reads are not update checks)
 * @returns {null | { kind: string, platform: string, arch: string, version: string, file: string, country: string, source: string }}
 */
export function classify(r, siteOrigin) {
  if (r.method !== 'GET') return null;
  const source = /\bElectron\//.test(r.userAgent ?? '') ? 'app' : 'web';
  const country = r.country ?? '';

  const feed = FEEDS[r.file];
  if (feed) {
    if (r.origin === siteOrigin) return null; // the landing page filling in its download buttons
    return { kind: 'update-check', platform: feed.platform, arch: feed.arch, version: '', file: r.file, country, source };
  }

  for (const { re, platform } of INSTALLERS) {
    const m = re.exec(r.file);
    if (!m) continue;
    if (!fromStart(r.range)) return null;
    return {
      kind: source === 'app' ? 'update-download' : 'download',
      platform,
      arch: ARCH[m[2]] ?? m[2],
      version: m[1],
      file: r.file,
      country,
      source,
    };
  }
  return null;
}

/** The Analytics Engine data point for a classified request (blob order is what the stats queries use). */
export function dataPoint(c) {
  return {
    indexes: [c.kind],
    blobs: [c.kind, c.platform, c.arch, c.version, c.file, c.country, c.source],
    doubles: [1],
  };
}
