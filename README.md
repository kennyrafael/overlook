# Overlook — a project dashboard for Claude Code
By [AgentHub](https://overlook.agenthub.pt).

A local-only dashboard for the projects you work on with Claude Code: status, milestones done
and missing, progress, a Kanban board that edits your plan files, git activity and Claude usage.
Runs on your machine at `http://127.0.0.1:4317`; no account, nothing leaves your computer.

## Quick start

Requires Node.js 20+ and git.

```bash
npm install
npm start
```

Open http://127.0.0.1:4317, go to **Settings**, add the folder that holds your projects
(e.g. `C:\Users\you\Documents\study`) and **Save & rescan**. `npm run start:open` also opens
the browser. `npm start` rebuilds only when the sources changed.

`.npmrc` pins this project to the public npm registry.

## What you get

| Page | Highlights |
|---|---|
| **Overview** | KPIs, status donut, last-activity, source, progress, Claude sessions, milestones and tag charts that cross-filter each other; burnup over 90 days |
| **Projects** | Searchable, filterable table; pin, tag, rename, override status; quick actions |
| **Project** | Progress dial, burnup, milestones with tasks (tick to complete, add inline), Board, Git and Claude tabs |
| **Board** | Kanban across one or all projects; drag cards between To do / In progress / Done |
| **Claude** | Sessions, prompts, tokens, estimated cost per day by model and per project, session list |
| **Git** | Uncommitted files, unpushed commits, 90-day commit heatmap, per-repo table |
| **Settings** | Root folders, ignore list, plan file names, Claude history options, model prices |

Across all pages: one filter bar with removable chips and **saved views**, **Ctrl+K** command
palette, live updates (top bar shows **Live**), dark/light theme, works at phone width.

## How projects are found

- Every folder under a root that has `.git`, `CLAUDE.md`, `.claude` or a plan file is a project;
  nested repos inside it are folded in as "included folders".
- Folders you used Claude Code in (`~/.claude/projects`) are merged in; sessions in sub-folders
  and `.claude/worktrees` count toward the parent project. The desktop app's scratch workspaces
  and deleted folders are excluded by default (Settings).
- Status: **paused** after 14 idle days (configurable), **done** when all milestones are reached,
  or set manually.

## Plan file format

Progress = reached milestones / total milestones. Milestones come from the plan files named in
Settings (default `PLAN.md`, `ROADMAP.md`, `CLAUDE.md`, `TODO.md`) in the project folder and its
included folders.

```md
## Phase 1: Scaffold          ← a heading with checkboxes under it is a milestone
- [x] Monorepo                ← done
- [~] API                     ← in progress (also [/] or [-])
- [ ] Web app                 ← to do
  wrapped lines stay part of the item above

## ✅ Research                ← heading marked ✅ or [x] = reached, even without tasks
## [ ] Launch                 ← heading marked [ ] = open milestone without tasks
```

Headings without checkboxes (docs, decisions) are ignored, as is anything inside code fences.

## Editing plan files

The Board and the Milestones tab write to your plan files:

- Moving a card changes only its checkbox; **Undo** is offered for 5 seconds.
- Adding appends at the end of the milestone with the same bullet and indent; renaming writes one
  line; deleting refuses tasks with sub-tasks (and asks first).
- Every write re-reads the file and finds the task by its text, so your other edits are kept.
  If the task itself changed since the page loaded, nothing is written (HTTP 409) and the page
  reloads. Line endings are preserved.
- The previous version is backed up to `~/.claude-projects-dashboard/backups/` (last 20 per file).
  Nothing extra is ever written inside your projects.

## Live updates and history

Open pages update by themselves (Server-Sent Events, `GET /api/events`):

| Change | Detected by | Updates |
|---|---|---|
| Plan file edited elsewhere | watcher on project folders | project, board, charts; toast |
| Edit from another dashboard tab | the write itself | same, no toast |
| Commit, checkout, fetch, push | watcher on `.git` HEAD, index, reflog, remote refs | Git views |
| Uncommitted file edits | git re-check every 3 min | Git views |
| Claude session activity | watcher on `~/.claude/projects` | Claude views |

The **burnup** is recorded once a day per project. On start, the last 90 days are rebuilt from
each plan file's git history (only for days without a value). Untracked plan files start their
history the first day the dashboard sees them.

## Git and Claude insights

- **Git** is read-only and never takes the index lock (`GIT_OPTIONAL_LOCKS=0`), so it can't block
  your own git commands. Cached 60 s; *Refresh* re-reads.
- **Claude usage** comes from `~/.claude/projects/**/*.jsonl` (sessions and their subagents),
  counted once per model reply. Files are streamed and cached by size and modification time.
- **Costs are estimates at API list prices**, not a subscription bill. Prices per model are in
  Settings → Cost estimates (matched by model-id prefix, longest wins); cache writes are priced at
  1.25× (5 min) and 2× (1 h) the input price.

## Quick actions and shortcuts

- Project header and the ↗ menu on each row: **Open in VS Code**, **Start Claude Code**
  (Windows Terminal running `claude` in the folder), **Open terminal**, **Show in Explorer**.
- **Ctrl+K**: jump to pages and projects, run quick actions ("alpha: Start Claude Code"), apply
  saved views, rescan, switch theme, clear filters.

## Safety

- Binds to `127.0.0.1` only. Requests with a non-local `Host` (DNS rebinding) or `Origin` (other
  websites) are refused, and every change needs an `x-cpd-client` header that other sites
  cannot send.
- Quick actions start programs directly, never through a shell; only the four actions exist,
  only for folders the dashboard discovered.
- Settings, saved views and task text are validated server-side.

## Configuration

| Variable | Default | |
|---|---|---|
| `CPD_DATA_DIR` | `~/.claude-projects-dashboard` | database and plan-file backups |
| `CPD_PORT` | `4317` | server port |
| `CLAUDE_CONFIG_DIR` | `~/.claude` | where Claude Code keeps its history |

## Development

```bash
npm run dev          # API (tsc --watch + node --watch) and Vite → http://127.0.0.1:5173
npm test             # unit tests + API end-to-end tests (isolated temp folder)
npm run test:smoke   # browser smoke tests with Playwright, using your installed Chrome
npm run typecheck
```

- `apps/api` – NestJS + SQLite (TypeORM, better-sqlite3), chokidar, SSE
- `apps/web` – React 18 + Vite + PrimeReact + Chart.js, Zustand, dnd-kit
- `packages/shared` – types shared by both

Tests never touch your real projects or history: they build fixture projects and a fixture
Claude history in a temp folder.

**Known `npm audit` notes:** remaining advisories are in `glob`/`minimatch` (via TypeORM's entity
loader) and `picomatch` (via Vite, no fixed release yet). Neither receives outside input in this
app; the offered fix is a breaking downgrade.

See [PLAN.md](PLAN.md) for the original plan.

## Desktop app (Windows)

`apps/desktop` wraps the server and UI in an Electron window. The server runs in a separate process on a
random local port and only accepts requests carrying a per-launch token that only the app window has.
Data lives in `%APPDATA%\Overlook`.

```bash
npm run dist            # builds everything and the installers in apps/desktop/release/
npm run test:desktop    # smoke tests against release/win-unpacked/Overlook.exe (fixture data only)
```

- Installers: `Overlook-Setup-<version>-x64.exe` and `-arm64.exe`. They are unsigned, so Windows SmartScreen
  shows "Windows protected your PC": choose **More info → Run anyway**.
- Moving from the browser version: close the app, then run `node scripts/copy-old-data.mjs`.
- First launch opens a short setup: what stays local, which tools were found, and which folders to scan.
- Only one copy runs; launching again brings the window back. With **Keep running in the tray** on
  (Settings → Desktop app), closing the window keeps live updates going; quit from the tray icon.
- Claude Code history inside running WSL distros is included (Settings → Include Claude Code in WSL).
- The icon is rendered from `brand/mark.svg` with `npm run icon -w @overlook/desktop`.

## License and trademarks

Overlook is released under the [MIT License](LICENSE) by AgentHub. Third-party licenses are listed
in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Overlook is an independent project. It is not affiliated with, endorsed by or sponsored by
Anthropic, PBC. "Claude" and "Claude Code" are trademarks of Anthropic, used here only to describe
the tool this app works with.
