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
| **Git** | Uncommitted files, unpushed commits, 90-day commit heatmap, per-repo table; expand a repo for branches (ahead/behind, stale, merged) and worktrees |
| **Summary** | One week per project: tasks moved, commits, Claude sessions, time and cost; Copy as Markdown |
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

## Claude and the board

- **Start Claude on a task**: ▶ on an open card (or **Start Claude** in the task dialog) opens Claude
  Code at the project with the task as its first prompt. The prompt is built from the plan file using
  Settings → "Start Claude on this task" prompt (`{task}`, `{milestone}`, `{file}`). Where a terminal
  or a `claude.cmd` wrapper would re-read the text through a shell, Claude starts without it and the
  prompt is copied to your clipboard. Only To do tasks offer it; in-progress and done tasks hide it.
- **Resume**: idle live sessions and the Claude session table have **Resume**
  (`claude --resume <id>` in the folder the session ran in). Sessions from WSL resume inside WSL only.
- **Open in Claude app**: idle live sessions and the session page can also start a new session in the
  Claude desktop app (`claude://code/new`) in that folder, with a prompt that points Claude at the old
  transcript. The desktop app cannot resume a terminal session by id, so this is a fresh session; the app
  asks you to confirm the folder and the prompt is filled in, not sent.
- **Dismiss**: the × on an idle live session hides it from the board until Claude works in it again.
- **Sessions on a task**: each session is matched to the plan task it most likely worked on, from its
  title and a few of its prompts. Cards show how many recent sessions did, the task dialog lists them,
  and the session table shows the task. It is a guess; nothing is written.
- **"Claude is waiting"**: the desktop app shows a notification when a session finishes its turn
  (Settings → Desktop app, with a list of projects to leave out); a browser tab marks its title.

## Plan health, stale work and dates

- **Plan health**: the project page lists what in a plan file the dashboard cannot read or edit safely
  (tasks before the first heading, the same task text twice, `-[ ]` and other near-checkboxes,
  headings like `##Title`, very large files), each with what to change.
- **Stale in progress**: a task marked in progress longer than Settings → "Task stale after" days (7 by
  default; the date comes from `git blame` of its line) shows on Overview and under **Stale only** on
  the board. Uncommitted changes are never stale.
- **Due dates**: end a milestone heading with `(due 2026-12-15)`; it shows on the milestone and turns
  red when overdue. Headings without one parse as before.
- **Move a task** to another milestone (also in another plan file) from the task dialog; sub-tasks
  move with it.
- **Create PLAN.md** for a project without milestones: pick a template, read the preview, confirm.
  It never overwrites a file.

## Claude sessions in depth

- **Session page** (click a session): prompts in order, Claude's tokens and cost per prompt, tools
  used, files it edited.
- **Search** prompts and session titles on the Claude page (a local SQLite full-text index).
- **Tools** card: most-used tools and how often they failed. **Recent usage**: the last 5 hours and
  7 days, an estimate from local logs, not your plan's limit.
- **Cost per milestone** on the Milestones tab: the estimated cost of sessions matched to its tasks.

## Daily overview

- **Since you were away** on Overview: tasks completed, commits, sessions and cost since you last
  pressed "Mark as seen" on this device. Task changes are recorded in the app's database each time a
  plan file is read (`~/.claude-projects-dashboard`), never in your projects.
- The desktop app's **tray menu** lists live Claude sessions, recent projects and "Start Claude in…".

## Quick actions and shortcuts

- Project header and the ↗ menu on each row: **Open in VS Code**, **Start Claude Code**
  (`claude` in a terminal at the folder: Windows Terminal; Terminal or iTerm on macOS; on Linux the
  desktop's terminal, e.g. GNOME Terminal or Konsole, else `x-terminal-emulator`, kitty, Alacritty or
  xterm), **Open terminal**, **Show in Explorer / Finder / folder** (`xdg-open` on Linux). Actions whose
  tool is not installed are hidden.
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

## Desktop app (Windows, macOS, Linux)

`apps/desktop` wraps the server and UI in an Electron window. The server runs in a separate process on a
random local port and only accepts requests carrying a per-launch token that only the app window has.
Data lives in `%APPDATA%\Overlook` (Windows), `~/Library/Application Support/Overlook` (macOS) or
`~/.config/Overlook` (Linux).

```bash
npm run dist            # builds everything and this OS's installers in apps/desktop/release/
npm run test:desktop    # smoke tests against the unpacked app in release/ (fixture data only)
```

- Windows: `Overlook-Setup-<version>-x64.exe` and `-arm64.exe`. They are unsigned, so Windows SmartScreen
  shows "Windows protected your PC": choose **More info → Run anyway**. Updates install themselves.
- macOS: `Overlook-<version>-arm64.dmg` and `-x64.dmg`, ad-hoc signed: approve the first launch in
  System Settings → Privacy & Security → **Open Anyway**. The app tells you when a new version is out.
- Linux (built on Linux): `Overlook-<version>-x86_64.AppImage` / `-arm64.AppImage` (`chmod +x`, then run;
  updates itself) and `Overlook-<version>-amd64.deb` / `-arm64.deb` (`sudo apt install ./Overlook-….deb`;
  the app tells you when a new version is out). `OVERLOOK_ARCHS=x64 npm run dist` builds one arch. Without a
  display, run the smoke tests with `xvfb-run -a npm run test:desktop`; `OVERLOOK_EXE` points them at an
  AppImage or the installed `/opt/Overlook/overlook`.
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
