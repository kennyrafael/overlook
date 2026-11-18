// Points the download buttons straight at the latest release's installers. If the GitHub API is
// unreachable or rate-limited, the buttons keep linking to the releases page.
(async () => {
  try {
    const res = await fetch('https://api.github.com/repos/kennyrafael/overlook/releases/latest', { headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok) return;
    const rel = await res.json();
    const find = (arch) => rel.assets.find((a) => a.name.endsWith(`-${arch}.exe`));
    const mb = (a) => `${Math.round(a.size / 1048576)} MB`;
    for (const arch of ['x64', 'arm64']) {
      const a = find(arch);
      if (!a) continue;
      document.getElementById(`dl-${arch}`).href = a.browser_download_url;
      const sub = document.getElementById(`dl-${arch}-sub`);
      sub.textContent = `${sub.textContent} · ${mb(a)}`;
    }
    document.getElementById('dl-version').textContent = `Latest: ${rel.tag_name}.`;
  } catch { /* keep the fallback links */ }
})();
