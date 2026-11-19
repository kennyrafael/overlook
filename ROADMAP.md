# Roadmap: free desktop app first, paid later if there is demand

Goal: ship this dashboard as a **free, MIT-licensed** installable desktop app for **Windows and
macOS**, published by **AgentHub** (agenthub.pt). If people use it and ask for more, add signing,
paid features and licensing later (see "Later: if there is demand").
(iOS is out of scope: the app needs to read `~/.claude`, run git, watch folders and launch
VS Code/terminals, none of which iOS allows. Linux is out of scope for 1.0; revisit if users ask.)

This file is written in the dashboard's own plan format, so the dashboard tracks its progress.

## Context for a new session

- Monorepo (npm workspaces): `apps/api` (NestJS + SQLite via TypeORM/better-sqlite3, chokidar,
  SSE), `apps/web` (React 18 + Vite + PrimeReact + Chart.js, Zustand, dnd-kit),
  `packages/shared` (types). See `README.md` for features and `PLAN.md` for the original plan.
- Today: `npm start` builds and runs `apps/api/dist/main.js`, which serves the API and the built UI
  on `127.0.0.1:4317`. Data dir `~/.claude-projects-dashboard` (`CPD_DATA_DIR`), port `CPD_PORT`,
  Claude history `CLAUDE_CONFIG_DIR`.
- Security today: binds 127.0.0.1; `apps/api/src/common/local-only.middleware.ts` rejects
  non-local Host/Origin and requires `x-cpd-client: 1` on mutating requests.
- Server setup is shared in `apps/api/src/configure.ts` (used by `main.ts` and the e2e tests).
- Tests: `npm test` (23 unit + 15 API e2e in an isolated temp fixture), `npm run test:smoke`
  (9 Playwright tests using installed Chrome). Keep them green after every phase.
- Windows-specific bits: quick actions in `apps/api/src/actions/actions.service.ts`
  (VS Code via `Code.exe` next to `code.cmd`, Windows Terminal `wt.exe`); plan-file writes in
  `apps/api/src/plans/plan-file.service.ts` (rename retry for EPERM).
- Known gaps to fix before public release: TypeORM `synchronize: true` (no migrations); Start
  Claude Code is Windows-only; Claude Code's `.jsonl` log format is undocumented and may change.

## Decisions (made; revisit only with a reason)

| Topic | Decision | Why |
|---|---|---|
| Publisher | **AgentHub** (existing company); site on a subdomain of `agenthub.pt` | Reuses the company and domain already owned |
| License | **MIT**, `Copyright (c) 2026 AgentHub` | Builds trust for a tool that reads local files; later versions or paid add-ons can use another license |
| Price | **Free** for now | Prove demand before spending on signing and payments |
| Contributions | Own code only at first; add a CLA before accepting outside PRs | Keeps the option to relicense later versions |
| Desktop shell | **Electron** + **electron-builder** | Server is already Node; Tauri would need a bundled Node sidecar |
| Platforms | Windows x64 + arm64 (NSIS `.exe`), macOS (universal `.dmg`) | iOS cannot do what the app does; Linux deferred |
| Signing | **Unsigned** for the free release; download page explains SmartScreen / Gatekeeper steps | Saves Apple $99/yr and Windows signing costs until there is demand |
| Updates | Windows: electron-updater (works unsigned). macOS: in-app "new version available" notice + manual download | macOS auto-update requires a signed app |
| Privacy promise | "No project data ever leaves your machine." Network calls are listed in-app | Update checks are the only outbound call |
| Product name | **Overlook by AgentHub**, "a project dashboard for Claude Code"; site `overlook.agenthub.pt` | Only small unrelated projects use the name (a Filament PHP plugin, a homelab dashboard); "Claude" is Anthropic's trademark, so it stays a description only |

## Phase 0: Name, license and repository
- [x] `git init`, first commit, GitHub repository (`github.com/kennyrafael/overlook`)
- [x] Pick the product name: Overlook (web search for existing products done 2026-11-18)
- [x] Check EUIPO/WIPO trademark search for "Overlook" and "AgentHub" in software classes (9, 42)
- [x] GitHub repo name secured (`github.com/kennyrafael/overlook`)
- [x] Check the npm name/scope (`overlook`, `@overlook`) is free
- [x] Rename UI title, README, package names to Overlook (`@overlook/*`); keep "for Claude Code" as a descriptor only
- [x] Review Anthropic's trademark guidelines (2026-11-18): no logos or brand elements without approval; no implied affiliation
- [x] Add a "not affiliated with Anthropic" notice to the README
- [x] Replace the sparkle icon in the UI with an original Overlook mark (`OverlookMark`, `favicon.svg`); reuse it for the desktop app icon (avoid looking like Claude's logo or colours)
- [x] Use "Claude Code" only in plain text as a description (tagline, docs); never in the app name, icon, domain or ads headline (UI and installer audited 2026-11-18)
- [x] Show the "not affiliated" notice in the About dialog (sidebar → About, or Ctrl+K → "About Overlook")
- [x] Show the "not affiliated" notice on the landing page footer (`site/index.html`)
- [x] Add `LICENSE` (MIT, Copyright (c) 2026 AgentHub)
- [x] Check dependency licenses (no GPL/AGPL); generate a third-party notices file (`npm run notices`)
- [x] Show `THIRD_PARTY_NOTICES.md` and the license in an About dialog (`GET /api/system/about`)
- [x] Acceptance: repo pushed with LICENSE and notices; name cleared on trademark search, GitHub and npm

## Phase 1a: Electron shell (Windows, unsigned)
- [x] Add `apps/desktop` workspace with Electron main + preload (TypeScript)
- [x] Run the Nest server in an Electron `utilityProcess` from the main process (it posts `ready` when listening)
- [x] Pick a free port at launch (pass via `CPD_PORT`); load the UI from it in a `BrowserWindow`
- [x] Per-launch random token: passed to the server as `CPD_TOKEN`, to the window as an httpOnly cookie; middleware rejects requests without it
- [x] Data dir = `app.getPath('userData')` (set `CPD_DATA_DIR`); one-off `node scripts/copy-old-data.mjs` copies the old `~/.claude-projects-dashboard`
- [x] `better-sqlite3` for Electron's ABI: prebuilt binary fetched per arch (Electron 42 / ABI 146; 12.x has no prebuilds for newer Electron, and source builds need Python + Visual Studio)
- [x] Security hardening: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, strict CSP, permissions denied, minimal preload (no IPC yet; validate every message when added)
- [x] Electron fuses: disable `RunAsNode` and `NODE_OPTIONS`, enable asar integrity and only-load-from-asar
- [x] Open external links in the default browser; block navigation and `window.open` away from the app origin
- [x] electron-builder config: NSIS installer (x64 + arm64), app icon from `brand/mark.svg`, start-menu and desktop shortcuts, uninstaller (`npm run dist`)
- [x] Smoke tests run against the packaged app (`npm run test:desktop`; Playwright over CDP, since fuses disable the Node inspector `_electron` needs)
- [x] Acceptance: fresh Windows VM without Node installs the `.exe`, finds projects, edits a plan file, shows live updates

## Phase 1b: Desktop polish
- [x] Single-instance lock; tray icon with optional "Keep running in the tray" (Settings → Desktop app); server closes watchers and the database on quit
- [x] Native folder picker for root folders ("Add folders…" in Settings and setup; IPC checked against the app origin)
- [x] First-run setup dialog: explains local-only, shows detected tools (`GET /api/system/tools`), picks roots; skippable
- [x] Quick-action fallbacks: Command Prompt when Windows Terminal is missing; actions whose tool is missing (VS Code, Claude Code) are hidden
- [x] Claude Code inside WSL: reads `\\wsl.localhost\<distro>\home\<user>\.claude` of running distros (never starts one), maps Linux paths (`/mnt/c` → `C:`), polls for changes; unit-tested with a fake distro, not yet on real WSL
- [x] Acceptance: onboarding works on a VM with no VS Code, no Windows Terminal and Claude Code only in WSL

## Phase 2: Robustness for other people's machines
- [x] Replace `synchronize: true` with TypeORM migrations; generate the baseline migration; test upgrade from an old database
- [x] Claude log parser: tolerate unknown/changed fields, report "unrecognized log format" instead of failing; add fixtures from several Claude Code versions
- [x] Handle missing git gracefully (Git page explains how to install; discovery still works)
- [x] Large-history performance: parse in a worker thread; parse cache persisted in SQLite; `npm run bench:logs` (5 GB, 2026-11-18: worst API latency during parse 25 ms, cold parse 18 s, restart to full insights 2.2 s)
- [x] Settings import/export (JSON) and "reset app data"
- [x] Logs to a file in userData with rotation; "Open log folder" in Settings
- [x] "Network activity" section in Settings listing every call the app can make (update check only)
- [x] Acceptance: upgrading from a v0 database keeps all overrides (`migrations.spec.ts`); 5 GB of logs parse without freezing the UI and restart loads in under 3 s (`bench:logs`); an unknown log format shows a warning, not an error (`log-fixtures.spec.ts`)

## Phase 3: macOS (unsigned)
- [x] macOS CI runner (`macos-latest` in `ci.yml` and `release.yml`): typecheck, unit, e2e, browser and packaged smoke tests
- [x] Paths: `~/.claude`; VS Code from `/Applications` or `~/Applications` (`open -a`) or `code` on PATH; iTerm used when installed, else Terminal; login-shell PATH (+ Homebrew, `~/.local/bin`, `~/.claude/local`) so apps opened from Finder find `git`, `claude`, `code`
- [x] Start Claude Code on macOS: `osascript` with a fixed script; folder and program passed as `argv` and shell-quoted with `quoted form of` (unit-tested); `NSAppleEventsUsageDescription` for the automation prompt
- [x] Show in Finder; app menu (About, Check for Updates, Settings ⌘,, Hide, Quit ⌘Q, Edit, View, Window); shortcut hints show ⌘ on macOS; Dock click reopens the window
- [x] `.dmg` per arch (`x64`, `arm64`; not universal, which would need the two better-sqlite3 binaries merged with lipo), ad-hoc signed, macOS 12+
- [ ] Acceptance: on a fresh Mac, following the download page's "Open Anyway" steps, the app opens and passes the smoke suite (CI runs the smoke suite on macOS; a manual fresh-Mac install is still to do)

## Phase 4: Free public release
- [x] GitHub Actions, Windows: `ci.yml` (typecheck, unit, e2e, browser smoke on push to main); `release.yml` (tag `vX.Y.Z` → tests, `npm run dist`, packaged smoke, upload to Cloudflare R2, then a GitHub Release with the same files)
- [x] GitHub Actions, macOS build job: `release.yml` builds Windows and macOS in parallel; one publish job (R2, then GitHub Release) runs only if both pass
- [x] Cloudflare R2 bucket `overlook`, served by the `overlook-downloads` Worker (`workers/downloads/`, deployed from GitHub by Workers Builds) at `https://overlook-downloads.kennyrafael-cg.workers.dev/overlook/` (Range requests, CORS for the landing page); repo secrets `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`
- [x] First tagged release (`v0.1.0`, Windows) published to R2 and verified (feeds, Range requests, SHA-512)
- [x] Windows auto-update via electron-updater, generic feed on R2 (`https://overlook-downloads.kennyrafael-cg.workers.dev/overlook/latest.yml`, `latest-arm64.yml`; `OVERLOOK_DOWNLOAD_URL` overrides at build time). `updater.ts`: start-up + daily check, background download, "Restart now / Later"; tray → Check for updates; Settings → Desktop app toggle; listed in Network activity
- [x] macOS shows "new version available" with a Download button (compares `latest.yml` on the feed with the running version; start-up, daily, and menu → Check for Updates)
- [x] Set up `overlook.agenthub.pt` DNS (Vercel nameservers; resolves with HTTPS, 2026-11-18). Attach it to the landing page project when deploying
- [x] Landing page in `site/` (static, for a Vercel project with root directory `site`): download buttons read the R2 feeds, SmartScreen install steps, FAQ (Linux, iOS, macOS), not-affiliated footer
- [x] Deploy `site/` on Vercel and attach `overlook.agenthub.pt`
- [x] Landing page: macOS buttons (enabled once the release has the `.dmg`), Gatekeeper "Open Anyway" steps
- [x] Landing page: rebuild it as an interactive, animated page with real screenshots (Phases 4b-1 to 4b-6 below; live 2026-11-19, follow-ups in 4b-6)
- [ ] Docs from README sections (plan file format, safety, troubleshooting)
- [ ] Optional waitlist / "tell me about Pro" email signup to measure paid interest
- [ ] Beta with 5–10 Claude Code users on both platforms; fix top issues
- [ ] Launch (GitHub, Claude Code communities)
- [ ] Acceptance: a stranger installs from the landing page on Windows and macOS without help; a Windows install updates itself to the next release

## Landing page rebuild: concept and rules

The new `overlook.agenthub.pt` should make people want the app within one scroll. The idea comes from the
brand mark, a lens over layered horizon bands, and the name: **you stand at the overlook and see all your
projects at once.**

- **Signature moment (hero):** a full-screen landscape made of the mark's three horizon bands (`#8b93f5`,
  `#c7d2fe`, white on an indigo `#6366f1` → `#4338ca` dusk sky), each band its own parallax layer that moves
  with scroll and the pointer. The white lens ring sits over the horizon; inside it, the real Overlook
  dashboard shows through a circular mask. As you scroll, the lens grows to fill the screen and you "land"
  inside the app.
- **Textures:** fine film grain over everything (inline SVG `feTurbulence` as a `data:` URI), topographic
  contour lines in the background (it's a lookout over terrain), soft glass on the lens (`backdrop-filter`),
  light glow along the band edges. Grain and contours stay subtle, under 6% opacity.
- **Show, don't tell:** each feature is a small demo you can use, built in plain DOM (lightweight copies of the
  app's UI with made-up projects), not a screenshot with a caption.
- **Motion rules:** animations follow scroll and clicks, nothing loops forever; easing feels like the app (no
  bounces); `prefers-reduced-motion` turns parallax and scroll animation into simple fades and keeps every
  demo usable; no scroll-jacking. Native scrolling always works.
- **Brand and trademark:** indigo palette only; no Claude orange, sparkles or starbursts; "Claude Code" in plain
  text only; the not-affiliated footer stays.
- **Budget:** Lighthouse ≥ 95 performance and 100 accessibility on mobile; LCP < 2 s on a mid-range phone; JS
  ≤ 90 KB gzip on first load (demos load lazily when they come close); 60 fps scroll on a 2020 laptop; page
  works at 320 px wide with a 16 px gutter.
- **Stack:** Vite + TypeScript, no framework (static output in `site/dist`, so Vercel stays static). Animation
  with CSS scroll-driven animations (`animation-timeline: view()`) where supported, falling back to a small
  `IntersectionObserver` + `requestAnimationFrame` helper; Motion (`motion`, MIT) only if the hand-written
  helper is not enough. Fonts self-hosted (Inter variable, OFL). CSP stays `script-src 'self'`; nothing from
  third-party hosts.

## Phase 4b-1: Groundwork
- [x] Move `site/` to Vite + TypeScript (`site/src`, build to `site/dist`; its own package and lockfile, not a workspace, so Vercel installs only what the site needs); `vercel.json` sets install/build/output and keeps the CSP (plus `font-src`); `vite preview` sends the same headers; CI job `site` runs tests and the build
- [x] Port `download.js` to a typed module with its tests (feed parsing, Mac detection, disabled `.dmg` buttons), so download buttons behave exactly as today (`site/src/download.ts`)
- [x] Design tokens from `brand/` (colors, radii, type scale, motion durations and easing) in one CSS file, light and dark
- [x] Self-host Inter (variable, Latin subset, 48 KB); `npm run notices` now also writes `site/public/third-party-notices.txt` (linked in the footer)
- [x] Motion helper (`site/src/motion/`): scroll progress per section, pointer parallax, reveals, reduced-motion switch, pause when the tab is hidden
- [x] Demo data (`site/src/demo/data.ts`): five made-up projects with plans, commits and Claude sessions, shared by the screenshots and the demos
- [x] Screenshot script (`cd site && npm run shots`, after `npm run build`): builds the demo repos with real git history (so the burnup backfills), runs the app on them and saves 6 pages in light and dark as AVIF/WebP at 1x and 2x to `site/src/assets/shots/`; paths are shown as `~/code/…` and the run fails if the user name is visible

## Phase 4b-2: Hero, the view from the overlook
- [x] Horizon landscape in SVG: three band layers plus a far ridge; each moves at its own speed with scroll and pointer (pointer only with a mouse or trackpad; no device tilt, no idle loops)
- [x] Lens: white ring with glass effect showing the Overview screenshot through a circular mask, aimed at the KPI cards; follows the pointer slightly; grows to full screen over a sticky scroll and hands off to the next section (`site/src/hero/`, maths unit-tested so the screenshot always covers the lens)
- [x] Grain overlay and contour-line background (generated, drawn in once), tuned for light and dark
- [x] Headline, one-line pitch and the main download button (picked for the visitor's OS) visible without scrolling; version and size underneath; all four builds in a Download section further down
- [x] Static fallback: reduced motion, data saver, very slow devices and no JavaScript get the still scene (same markup, one screen tall, lens at rest) instead of a separate image

## Phase 4b-3: Feature demos
- [x] Discovery: scattered folders and repos fly into a tidy project grid as the section scrolls in, each with status and progress
- [x] Plans become a board (the main demo): a plan file on the left, a Kanban board on the right; drag a card to Done (mouse), tap it and pick a column (touch), or use the arrow keys, and the `- [ ]` in the file turns into `- [x]`, the progress bars and burnup move, and an Undo toast appears; clicking a checkbox in the file works too
- [x] Usage: a daily tokens and estimated-cost chart that draws itself, with a model and project filter and hover tooltips; says "estimates at API list prices"
- [x] Git: a 90-day commit heatmap that ripples in, with uncommitted/unpushed badges; hover shows the day
- [x] Ctrl+K / ⌘K on the page opens a copy of the command palette ("alpha: Start Claude Code") that jumps between sections
- [x] Privacy: "Nothing leaves your machine": the lens closes over a laptop, and a network list shows the update check as the only outbound call (with its on/off switch)
- [x] Demos load only when their section comes near (first load: 7 KB of JS gzip; all demos together ~13 KB more); each shows a real screenshot until then and without JavaScript
- [x] `cd site && npm run check:demos` drives the built site in Chrome with no server (files served from disk with the Vercel headers and CSP, feed faked): every demo, light desktop, dark phone and reduced motion

## Phase 4b-4: Install, FAQ and trust
- [x] Install steps as Windows / macOS tabs, picked from the visitor's OS (links to `#install` / `#install-mac` open the right one; both shown without JavaScript), with annotated sketches of the SmartScreen and "Open Anyway" dialogs drawn in the page's own colours
- [x] FAQ kept and refreshed (added "How does it read my plans?" with the plan format and "Are the costs what I pay?")
- [x] Trust strip: MIT, open source on GitHub, local-only, no account, current version and release date from the feed
- [x] Final call to action: the landscape again at night, lens closed, download buttons for all four builds
- [x] Footer: AgentHub, license, GitHub, not-affiliated notice

## Phase 4b-5: Polish and checks
- [x] Responsive pass at 320, 375, 768, 1024, 1440 and 1920 px; no horizontal scroll, nothing sticking out; on touch screens, board cards move by tap + "Move to" (drag is for mouse and pen); the hero lens is placed from the bottom on phones so it never covers the text (`npm run audit`)
- [x] Accessibility: headings in order, demos usable with keyboard and screen reader (live region for "task moved to Done"), contrast AA, visible focus; axe-core (WCAG 2.1 A/AA) finds nothing in light and dark (fixed: heatmap roles, checkbox and chip contrast, names that did not match the visible text)
- [x] Performance pass: Lighthouse mobile 97–98 / 100 / 96 / 100 (performance / accessibility / best practices / SEO) and LCP 1.96 s on a quiet machine (85–91 when the laptop was busy: same requests, slower CPU); desktop 100 / 100 / 96 / 100. CSS inlined, font preloaded, 900 px images for phones, contours fade instead of animating paths, below-the-fold setup on idle, `content-visibility` for off-screen sections. Re-check on the live site with PageSpeed Insights
- [x] Browsers: Chrome, Edge, Firefox and WebKit (Safari's engine) pass both suites (`BROWSER=msedge|firefox|webkit`); the motion system is JS-driven, so there is no CSS scroll-timeline path to fall back from. Real Safari on macOS / iOS still to try by hand
- [x] Open Graph / social card image made from the hero (`npm run og` → `public/og.jpg`), `og:` and Twitter tags, canonical URL, `sitemap.xml`, `robots.txt`
- [x] Browser checks for the site in CI (`site` job: `check:demos` + `audit` in the runner's Chrome, screenshots uploaded on failure): no console errors, download buttons point at the feed, the board demo ticks a checkbox, reduced motion and JavaScript-off render

## Phase 4b-6: Ship
- [ ] Review on a real Windows PC, Mac and phone (the preview step was skipped by choice: shipped straight to production after the checks in four browser engines)
- [x] Deploy to `overlook.agenthub.pt` (2026-11-19; the Vercel build had failed since 4b-1 because `site/tsconfig.json` extended a file outside the Root Directory); checked live: CSP and security headers, Brotli, immutable asset caching, robots/sitemap/og, the real feed (CORS), all four installers, Windows and Mac visitors get the right main button, all demos load in Chrome, Firefox and WebKit with no console errors
- [ ] Acceptance: a first-time visitor understands what Overlook does from the hero and one demo, finds the right download without scrolling, and the page meets the performance and accessibility budget (live, from this laptop: accessibility, best practices and SEO 100 on mobile and desktop, desktop performance 98; mobile performance 81–86 with LCP 3.0 s, under the 95 / 2 s budget: confirm with PageSpeed Insights and do a mobile performance pass if it agrees; first-visitor test still to do)

## Later: if there is demand
Start only when there are real users asking for more (for example: steady downloads, waitlist signups, feature requests).
- [ ] Code signing: Apple Developer Program ($99/yr) with notarization; Windows Azure Trusted Signing or OV certificate
- [ ] macOS auto-update once builds are signed
- [ ] Decide the paid model: open core (MIT base + paid Pro add-ons) or closed license for a new major version
- [ ] Payments via a merchant of record (Lemon Squeezy or Paddle) so VAT is handled
- [ ] Offline Ed25519-signed license keys for paid features; no DRM; never lock users out of their own plan files
- [ ] EULA for paid features, refund policy, privacy policy; legal review before taking money
- [ ] Contributor agreement (CLA) in place before relicensing anything

## Risks to keep in view
- Claude Code may change its log format or folder layout at any time: keep the parser defensive and ship fixes quickly.
- Anthropic could ship its own project dashboard for Claude Code: keep costs low while the app is free.
- "AgentHub" is a common phrase in AI tools: a trademark clash could force a rename, so give the product its own name.
- Unsigned builds show OS warnings that put some users off: explain them clearly on the download page.
- Cost figures are estimates at API list prices, not billing; keep that wording everywhere.
- Writing to users' plan files is the riskiest feature: keep backups, conflict checks and Undo; never write outside discovered plan files.
- MIT versions stay MIT forever: anyone may fork them, so paid value must come from new work.
