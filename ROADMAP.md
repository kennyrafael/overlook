# Roadmap: free desktop app first, paid later if there is demand

Goal: ship this dashboard as a **free, MIT-licensed** installable desktop app for **Windows and
macOS**, published by **AgentHub** (agenthub.eu). If people use it and ask for more, add signing,
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
| Publisher | **AgentHub** (existing company); site on a subdomain of `agenthub.eu` | Reuses the company and domain already owned |
| License | **MIT**, `Copyright (c) 2026 AgentHub` | Builds trust for a tool that reads local files; later versions or paid add-ons can use another license |
| Price | **Free** for now | Prove demand before spending on signing and payments |
| Contributions | Own code only at first; add a CLA before accepting outside PRs | Keeps the option to relicense later versions |
| Desktop shell | **Electron** + **electron-builder** | Server is already Node; Tauri would need a bundled Node sidecar |
| Platforms | Windows x64 + arm64 (NSIS `.exe`), macOS (universal `.dmg`) | iOS cannot do what the app does; Linux deferred |
| Signing | **Unsigned** for the free release; download page explains SmartScreen / Gatekeeper steps | Saves Apple $99/yr and Windows signing costs until there is demand |
| Updates | Windows: electron-updater (works unsigned). macOS: in-app "new version available" notice + manual download | macOS auto-update requires a signed app |
| Privacy promise | "No project data ever leaves your machine." Network calls are listed in-app | Update checks are the only outbound call |
| Product name | **Overlook by AgentHub**, "a project dashboard for Claude Code"; site `overlook.agenthub.eu` | Only small unrelated projects use the name (a Filament PHP plugin, a homelab dashboard); "Claude" is Anthropic's trademark, so it stays a description only |

## Phase 0: Name, license and repository
- [x] `git init`, first commit, GitHub repository (`github.com/kennyrafael/overlook`)
- [x] Pick the product name: Overlook (web search for existing products done 2026-11-18)
- [x] Check EUIPO/WIPO trademark search for "Overlook" and "AgentHub" in software classes (9, 42)
- [ ] Set up `overlook.agenthub.eu`; check GitHub org/repo and npm names are free
- [x] Rename UI title, README, package names to Overlook (`@overlook/*`); keep "for Claude Code" as a descriptor only
- [x] Review Anthropic's trademark guidelines (2026-11-18): no logos or brand elements without approval; no implied affiliation
- [x] Add a "not affiliated with Anthropic" notice to the README
- [x] Replace the sparkle icon in the UI with an original Overlook mark (`OverlookMark`, `favicon.svg`); reuse it for the desktop app icon (avoid looking like Claude's logo or colours)
- [x] Use "Claude Code" only in plain text as a description (tagline, docs); never in the app name, icon, domain or ads headline (UI and installer audited 2026-11-18)
- [x] Show the "not affiliated" notice in the About dialog (sidebar → About, or Ctrl+K → "About Overlook")
- [ ] Show the "not affiliated" notice on the landing page footer (with the landing page, Phase 4)
- [x] Add `LICENSE` (MIT, Copyright (c) 2026 AgentHub)
- [x] Check dependency licenses (no GPL/AGPL); generate a third-party notices file (`npm run notices`)
- [x] Show `THIRD_PARTY_NOTICES.md` and the license in an About dialog (`GET /api/system/about`)
- [ ] Acceptance: repo pushed with LICENSE and notices; name cleared on trademark search, subdomain and GitHub

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
- [ ] Acceptance: fresh Windows VM without Node installs the `.exe`, finds projects, edits a plan file, shows live updates

## Phase 1b: Desktop polish
- [x] Single-instance lock; tray icon with optional "Keep running in the tray" (Settings → Desktop app); server closes watchers and the database on quit
- [x] Native folder picker for root folders ("Add folders…" in Settings and setup; IPC checked against the app origin)
- [x] First-run setup dialog: explains local-only, shows detected tools (`GET /api/system/tools`), picks roots; skippable
- [x] Quick-action fallbacks: Command Prompt when Windows Terminal is missing; actions whose tool is missing (VS Code, Claude Code) are hidden
- [x] Claude Code inside WSL: reads `\\wsl.localhost\<distro>\home\<user>\.claude` of running distros (never starts one), maps Linux paths (`/mnt/c` → `C:`), polls for changes; unit-tested with a fake distro, not yet on real WSL
- [ ] Acceptance: onboarding works on a VM with no VS Code, no Windows Terminal and Claude Code only in WSL

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
- [ ] Get Mac hardware or a macOS CI runner for builds and tests
- [ ] Paths: `~/.claude`, `/Applications/Visual Studio Code.app` or `code` on PATH, Terminal/iTerm
- [ ] Start Claude Code on macOS (open Terminal at the folder running `claude`, via AppleScript `osascript` with fixed script and the path passed as an argument)
- [ ] Show in Finder; app menu (About, Preferences, Quit); keyboard shortcuts use ⌘
- [ ] Universal (`x64` + `arm64`) `.dmg` build, ad-hoc signed
- [ ] Acceptance: on a fresh Mac, following the download page's "Open Anyway" steps, the app opens and passes the smoke suite

## Phase 4: Free public release
- [ ] GitHub Actions: build Windows + macOS on tags; run unit, e2e and packaged smoke tests; publish to GitHub Releases
- [ ] Windows auto-update via electron-updater from GitHub Releases; macOS shows "new version available" with a download link
- [ ] Landing page on the AgentHub subdomain: screenshots, download buttons, install steps for SmartScreen and Gatekeeper warnings, FAQ (iOS and Linux: not supported and why)
- [ ] Docs from README sections (plan file format, safety, troubleshooting)
- [ ] Optional waitlist / "tell me about Pro" email signup to measure paid interest
- [ ] Beta with 5–10 Claude Code users on both platforms; fix top issues
- [ ] Launch (GitHub, Claude Code communities)
- [ ] Acceptance: a stranger installs from the landing page on Windows and macOS without help; a Windows install updates itself to the next release

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
