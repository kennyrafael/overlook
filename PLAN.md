# Overlook (originally "Claude Projects Dashboard") — Plan

Local-only dashboard (no auth, bound to `127.0.0.1`) to track local Claude projects: status, milestones done/missing, progress %, Claude usage and git activity.

## 1. Decisions (from interview)

| Topic | Choice |
|---|---|
| Frontend | React 18 + Vite + TypeScript + **PrimeReact** (+ PrimeIcons, PrimeFlex), Chart.js via PrimeReact `Chart` |
| Backend | **NestJS** + SQLite (TypeORM or Prisma, `better-sqlite3`) |
| Data | Auto-scan + manual edits in UI |
| Discovery | Root-folder scan **merged with** `~/.claude/projects` history, plus ignore list |
| Progress % | **Milestone-based**: reached milestones / total milestones (tasks under a milestone give partial-progress hint only) |
| Milestones | **Parsed from plan files** (`PLAN.md`, `ROADMAP.md`, `CLAUDE.md`, `TODO.md`); UI edits are **written back** to the file |
| Features | Overview KPIs + charts, Kanban board, Claude usage insights, Git activity |
| Interaction | Cross-filtering drill-down, live refresh (WebSocket), quick actions, Ctrl+K palette, saved views, dark/light |

## 2. Architecture

```
apps/
  web/   React + PrimeReact (Vite, port 5173 in dev; served by API in prod)
  api/   NestJS (port 4317, 127.0.0.1 only)
    modules/
      config/      roots, ignore list, plan-file names (settings table)
      discovery/   root scan + ~/.claude/projects decoding → project list
      plans/       markdown parser + writer (milestones, tasks)
      git/         simple-git: commits, branches, dirty files, ahead/behind
      claude/      parse ~/.claude/projects/*/*.jsonl: sessions, tokens, cost, last activity
      projects/    aggregate + REST
      watcher/     chokidar on plan files, .git/HEAD, .jsonl → recompute → WS push
      actions/     open in VS Code / terminal / explorer / start `claude`
      events/      Socket.IO gateway
  shared/  TS types (Project, Milestone, Task, GitStats, ClaudeStats)
```

SQLite holds: settings, project overrides (custom name, tags, manual status, pinned, archived), saved views, cached scan snapshots (for history/trend charts), task board order. Files on disk remain the source of truth for milestones/tasks.

## 3. Data model

- **Project**: id (path hash), path, name, tags, status (`active | paused | blocked | done | archived` — derived, overridable), progress %, lastActivity, source (`root | claude | both`).
- **Milestone**: parsed from a `## Heading` (or `- [ ] **Milestone:**` line); reached when all its checkboxes are `[x]` or heading marked `✅`/`[x]`. Stores file + line range for write-back.
- **Task**: markdown checkbox under a milestone; Kanban column via inline marker (`[ ]` todo, `[~]` in progress, `[x]` done) — written back on drag.
- **GitStats**: branch, dirty count, ahead/behind, commits per day (90d), last commit.
- **ClaudeStats**: sessions, messages, input/output/cache tokens, est. cost, per-day series, models used.
- **Snapshot**: daily progress per project → burnup/trend charts.

Status derivation: 100% → done; no activity 14d → paused; `BLOCKED` tag in plan → blocked; else active.

## 4. Screens (PrimeReact components)

1. **Overview**
   - KPI cards: projects, active, avg progress, milestones left, Claude tokens/cost this week, commits this week (`Card`, `Knob`, `Tag`).
   - Charts: status doughnut, progress bar-per-project (horizontal), milestone burnup over time (line), Claude tokens/day (stacked bar by model), commit heatmap (custom grid), activity radar per project.
   - **Cross-filtering**: clicking a slice/bar sets a global filter (status, project, date range) shown as removable `Chip`s; all widgets react.
2. **Projects list** — `DataTable` with sort/filter/global search, inline `ProgressBar`, status `Tag`, sparkline, row expansion with milestones; toggle to card `DataView`.
3. **Project detail** — header with quick actions (`SplitButton`), `TabView`: Milestones (`Timeline` + `Accordion` checklists, editable), Board, Git, Claude, Files (detected plan files).
4. **Kanban board** — per project or all projects; drag-and-drop (dnd-kit, styled with PrimeReact `Card`/`Badge`); edits written to markdown; `Toast` on save / conflict.
5. **Claude insights** — sessions table, token/cost charts, top projects by usage, `Calendar` range picker.
6. **Git activity** — dirty repos list, ahead/behind, commit timeline across projects.
7. **Settings** — roots (`Chips`), ignore list, plan filenames, stale threshold, theme, cost per model.

Global: `Menubar`/`Sidebar` nav, Ctrl+K command palette (`Dialog` + `AutoComplete`: jump to project, run action, apply view), saved views (`Dropdown` + save), theme switcher (lara-light/lara-dark), `ConfirmDialog` before file write-backs (toggleable).

## 5. API (REST + WS)

```
GET  /projects?status=&tag=&q=      GET  /projects/:id
PATCH /projects/:id                 (overrides: name, tags, status, pinned)
GET  /projects/:id/milestones       PATCH /tasks/:id {status|text}   → writes markdown
POST /projects/:id/milestones       POST /tasks
GET  /stats/overview?from=&to=      GET  /stats/claude   GET /stats/git
POST /actions/:id/{vscode|terminal|explorer|claude}
GET/PUT /settings                   CRUD /views
POST /rescan
WS   project:updated, scan:progress, file:conflict
```

## 6. Key implementation notes

- **Write-back safety**: store file mtime + hash at read; reject write if changed (emit `file:conflict`), edit only the exact line range, keep a `.bak` of last version, debounce watcher self-triggers.
- **Claude history**: `~/.claude/projects/<encoded-path>/*.jsonl`; decode path, sum `usage` fields, group by day/model; parse incrementally (remember byte offset per file).
- **Windows**: path normalization, `code` / `wt.exe` / `explorer.exe` for quick actions; spawn without shell interpolation, whitelist actions only.
- **Security**: bind `127.0.0.1`, CORS only for the Vite origin, actions only on discovered project paths.
- **Performance**: scan in background job with progress via WS; cache in SQLite; virtual scroll in tables.

## 7. Milestones (build order)

1. **Scaffold** — monorepo (pnpm workspaces), NestJS + SQLite, Vite + PrimeReact, shared types, theme.
2. **Discovery + projects list** — root scan, Claude history merge, settings page, DataTable.
3. **Plan parser** — milestones/tasks from markdown, progress %, project detail Milestones tab.
4. **Overview** — KPI cards, charts, global filter store (Zustand) with cross-filtering.
5. **Write-back + Kanban** — task edits, drag-and-drop, conflict handling.
6. **Git + Claude modules** — stats endpoints, insights pages, heatmap.
7. **Live refresh** — chokidar watcher, Socket.IO, daily snapshots → burnup chart.
8. **Power features** — quick actions, Ctrl+K palette, saved views.
9. **Polish** — tests (parser unit tests, API e2e, Playwright smoke), single `pnpm start` that serves the built UI.

## 8. Open questions

- Plan file format convention: OK to standardize on `## Milestone` + `- [ ]` checklist, with `[~]` for in progress?
- Cost estimates: use public per-model pricing table editable in Settings?
- Should archived projects be hidden from all charts by default?
