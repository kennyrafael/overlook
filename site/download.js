// Points the download buttons at the latest installers, read from the update feeds on Cloudflare R2
// (the same latest.yml / latest-arm64.yml the app uses). The bucket needs a CORS rule allowing GET
// from https://overlook.agenthub.pt. If a feed cannot be read, the buttons keep their fallback link.
const DOWNLOADS = 'https://dl.agenthub.pt/overlook';

/** Reads `version`, `path` and the first file's `size` from an electron-builder feed. */
function parseFeed(text) {
  const get = (key) => text.match(new RegExp(`^${key}:\\s*'?([^'\\n]+)'?\\s*$`, 'm'))?.[1];
  const size = Number(text.match(/^\s+size:\s*(\d+)/m)?.[1]);
  return { version: get('version'), path: get('path'), size };
}

(async () => {
  let version = '';
  for (const [arch, feed] of [['x64', 'latest.yml'], ['arm64', 'latest-arm64.yml']]) {
    try {
      const res = await fetch(`${DOWNLOADS}/${feed}`, { cache: 'no-cache' });
      if (!res.ok) continue;
      const f = parseFeed(await res.text());
      if (!f.path || !/^[\w.-]+\.exe$/.test(f.path)) continue;
      document.getElementById(`dl-${arch}`).href = `${DOWNLOADS}/${encodeURIComponent(f.path)}`;
      if (f.size) {
        const sub = document.getElementById(`dl-${arch}-sub`);
        sub.textContent = `${sub.textContent} · ${Math.round(f.size / 1048576)} MB`;
      }
      version ||= f.version ?? '';
    } catch { /* keep the fallback link */ }
  }
  if (version) document.getElementById('dl-version').textContent = `Latest: v${version}.`;
})();
