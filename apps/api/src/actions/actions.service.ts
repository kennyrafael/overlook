import { BadRequestException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { execFile, spawn } from 'child_process';
import { accessSync, constants, existsSync, realpathSync, statSync } from 'fs';
import { homedir } from 'os';
import { delimiter, dirname, join, resolve as resolvePath } from 'path';
import { isInside } from '../discovery/path-utils';
import type { ActionResult, ClaudeActionBody, ProjectAction, SystemTools } from '@overlook/shared';
import { PROJECT_ACTIONS } from '@overlook/shared';
import { SettingsService } from '../config/settings.service';
import { claudeRoots } from '../discovery/claude-roots';
import { ProjectsService, type ProjectRef } from '../projects/projects.service';
import { isBatchFile, SESSION_ID_RE, sessionCwd, taskPrompt, windowsTerminalText } from './claude-launch';
import { LINUX_TERMINAL_LABEL, linuxTerminalArgs, linuxTerminalOrder, passesTextArgs, terminalBehind, type LinuxTerminal } from './linux-terminal';

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
const IS_LINUX = process.platform === 'linux';

/**
 * The full path of a command on PATH, or null. Windows asks where.exe (it knows PATHEXT); elsewhere PATH is
 * searched directly, since minimal Linux installs (Arch, Fedora containers) have no `which`.
 */
function which(cmd: string): Promise<string | null> {
  if (!IS_WIN) {
    for (const dir of (process.env.PATH ?? '').split(delimiter)) {
      if (!dir.startsWith('/')) continue;
      const file = join(dir, cmd);
      try {
        accessSync(file, constants.X_OK);
        if (statSync(file).isFile()) return Promise.resolve(file);
      } catch { /* not here */ }
    }
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    execFile('where.exe', [cmd], { windowsHide: true }, (err, out) => {
      resolve(err ? null : out.split(/\r?\n/).map((s) => s.trim()).find(Boolean) ?? null);
    });
  });
}

/** Starts a program detached from the server. Never uses a shell; the project path is only ever an argument or the cwd. */
function launch(file: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd, detached: true, stdio: 'ignore', windowsHide: false, shell: false });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}

/** macOS app bundles, checked in /Applications and ~/Applications. */
function macApp(name: string): string | null {
  for (const dir of ['/Applications', join(homedir(), 'Applications')]) {
    const p = join(dir, name);
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * AppleScript that opens a terminal window at a folder and runs a program there. The script text is
 * fixed; the folder and the program come in as arguments (`on run argv`) and are shell-quoted with
 * `quoted form of`, so nothing from the project path is ever interpreted as script or shell code.
 */
const MAC_COMMAND = [
  'on run argv',
  '  set cmd to "cd " & quoted form of (item 1 of argv) & " && " & quoted form of (item 2 of argv)',
  '  repeat with i from 3 to count of argv',
  '    set cmd to cmd & " " & quoted form of (item i of argv)',
  '  end repeat',
];
const MAC_TERMINAL_SCRIPT = [
  ...MAC_COMMAND,
  '  tell application "Terminal"',
  '    activate',
  '    do script cmd',
  '  end tell',
  'end run',
];
const MAC_ITERM_SCRIPT = [
  ...MAC_COMMAND,
  '  tell application "iTerm"',
  '    activate',
  '    set w to (create window with default profile)',
  '    tell current session of w to write text cmd',
  '  end tell',
  'end run',
];
/** `osascript` arguments that open Terminal (or iTerm) at `path` and run `program` there with `args` (each shell-quoted). */
export function macClaudeArgs(path: string, program: string, iterm: boolean, args: string[] = []): string[] {
  return [...(iterm ? MAC_ITERM_SCRIPT : MAC_TERMINAL_SCRIPT).flatMap((l) => ['-e', l]), path, program, ...args];
}

/** What to run in the terminal: the program, its fixed arguments, and an optional free-text prompt (last). */
interface TerminalRun {
  program: string;
  args: string[];
  prompt: string | null;
}

/**
 * Opens a discovered project in local tools. Only the four whitelisted actions
 * exist, and only for folders the dashboard discovered itself.
 */
@Injectable()
export class ActionsService {
  private readonly log = new Logger(ActionsService.name);
  private resolved = new Map<string, string | null>();

  constructor(private projects: ProjectsService, private settings: SettingsService) {}

  /** Which local tools are available, for onboarding and to hide actions that cannot work. */
  async tools(): Promise<SystemTools> {
    this.resolved.clear(); // re-detect: the user may have installed something since
    const [git, claude, vscode, wt, linuxTerm, opener, roots] = await Promise.all([
      this.resolve('git'),
      this.resolve('claude'),
      this.vsCodePath(),
      IS_WIN ? this.resolve('wt.exe') : Promise.resolve(null),
      IS_LINUX ? this.linuxTerminal() : Promise.resolve(null),
      IS_WIN || IS_MAC ? Promise.resolve('builtin') : this.resolve('xdg-open'),
      this.settings.get().then((s) => claudeRoots(s.useWsl)),
    ]);
    const terminal: SystemTools['terminal'] = IS_WIN ? (wt ? 'Windows Terminal' : 'Command Prompt')
      : IS_MAC ? (macApp('iTerm.app') ? 'iTerm' : 'Terminal')
      : linuxTerm ? LINUX_TERMINAL_LABEL[linuxTerm.term] : null;
    const present = roots.filter((r) => existsSync(r.dir));
    return {
      platform: process.platform,
      git: !!git,
      claude: !!claude,
      vscode: !!vscode,
      terminal,
      openFolder: !!opener,
      wslClaude: [...new Set(present.filter((r) => r.label.startsWith('WSL: ')).map((r) => r.label.slice(5)))],
      claudeHistory: present.map((r) => ({ label: r.label, dir: r.dir })),
    };
  }

  /**
   * VS Code's executable, or null. On Windows `code` is a .cmd wrapper, so use Code.exe next to it.
   * On macOS the app bundle is enough (opened with `open -a`), even when `code` is not on PATH.
   */
  private async vsCodePath(): Promise<string | null> {
    if (IS_MAC) {
      const bundle = macApp('Visual Studio Code.app');
      if (bundle) return bundle;
    }
    const cmd = await this.resolve('code');
    if (!cmd) return null;
    if (!IS_WIN) return cmd;
    const exe = join(dirname(dirname(cmd)), 'Code.exe');
    return existsSync(exe) ? exe : null;
  }

  /**
   * Runs a quick action. Only `claude` takes a body: `taskId` (a plan task of this project; the prompt is built
   * here from the task and Settings) or `resume` (a session id of this project). Both are optional.
   */
  async run(projectId: string, action: string, body: ClaudeActionBody = {}): Promise<ActionResult> {
    if (!PROJECT_ACTIONS.includes(action as ProjectAction)) throw new BadRequestException(`Unknown action ${action}`);
    const ref = (await this.projects.refs()).find((r) => r.id === projectId);
    if (!ref) throw new NotFoundException(`Project ${projectId} not found`);
    if (!ref.exists || !existsSync(ref.path)) throw new NotFoundException('The project folder no longer exists');

    const a = action as ProjectAction;
    const taskId = typeof body?.taskId === 'string' && body.taskId ? body.taskId : null;
    const resume = typeof body?.resume === 'string' && body.resume ? body.resume : null;
    if (a !== 'claude' && (taskId || resume)) throw new BadRequestException(`${a} takes no task or session`);
    if (taskId && resume) throw new BadRequestException('Give a task or a session to resume, not both');

    let result: ActionResult = { ok: true, action: a };
    let where = ref.path;
    try {
      if (a === 'explorer') await this.openFolder(ref.path);
      else if (a === 'vscode') await this.openVsCode(ref.path);
      else if (a === 'terminal') await this.openTerminal(ref.path, null);
      else if (a === 'claude') {
        const claude = await this.require('claude', 'Claude Code (claude)');
        if (resume) {
          where = await this.resumeFolder(ref, resume);
          await this.openTerminal(where, { program: claude, args: ['--resume', resume], prompt: null });
        } else if (taskId) {
          const prompt = await this.promptFor(ref.id, taskId);
          const passed = await this.openTerminal(ref.path, { program: claude, args: [], prompt });
          result = { ...result, promptPassed: passed, prompt };
        } else {
          await this.openTerminal(ref.path, { program: claude, args: [], prompt: null });
        }
      }
    } catch (e) {
      if (e instanceof ServiceUnavailableException || e instanceof NotFoundException || e instanceof BadRequestException) throw e;
      this.log.warn(`${a} failed for ${where}: ${e}`);
      throw new ServiceUnavailableException(`Could not start ${a}: ${e instanceof Error ? e.message : e}`);
    }
    this.log.log(`${a}${resume ? ' --resume' : taskId ? ' (task)' : ''} → ${where}`);
    return result;
  }

  /** The prompt for a plan task of the project, from Settings → claudeTaskPrompt. */
  private async promptFor(projectId: string, taskId: string): Promise<string> {
    const [project, settings] = await Promise.all([this.projects.get(projectId), this.settings.get()]);
    for (const m of project.milestones) {
      const t = m.tasks.find((x) => x.id === taskId);
      if (t) return taskPrompt(settings.claudeTaskPrompt, { task: t.text, milestone: m.title, file: m.relFile });
    }
    throw new NotFoundException('That task is no longer in the plan file; reload the page');
  }

  /**
   * The folder to resume a session in: where it ran (its log's cwd), when that is still there and inside the
   * project; otherwise the project folder. Only sessions logged on this machine can be resumed.
   */
  private async resumeFolder(ref: ProjectRef, sessionId: string): Promise<string> {
    if (!SESSION_ID_RE.test(sessionId)) throw new BadRequestException('Not a session id');
    const dir = ref.claudeDirs.find((d) => existsSync(join(d, `${sessionId}.jsonl`)));
    if (!dir) throw new NotFoundException('That session is not one of this project\'s');
    if (IS_WIN && dir.startsWith('\\\\')) throw new BadRequestException('Sessions from WSL can only be resumed inside WSL');
    const cwd = await sessionCwd(join(dir, `${sessionId}.jsonl`));
    const inProject = cwd && [ref.path, ...ref.subpaths].some((p) => isInside(resolvePath(cwd), p));
    return cwd && inProject && existsSync(cwd) ? cwd : ref.path;
  }

  private async resolve(cmd: string): Promise<string | null> {
    if (!this.resolved.has(cmd)) this.resolved.set(cmd, await which(cmd));
    return this.resolved.get(cmd)!;
  }

  private async require(cmd: string, label: string): Promise<string> {
    const found = await this.resolve(cmd);
    if (!found) throw new ServiceUnavailableException(`${label} was not found on PATH`);
    return found;
  }

  async openFolder(path: string) {
    if (IS_WIN) return launch('explorer.exe', [path], path);
    if (IS_MAC) return launch('open', [path], path);
    // xdg-open hands the folder to the desktop's file manager (xdg-utils; a dependency of the .deb).
    return launch(await this.require('xdg-open', 'xdg-open (xdg-utils)'), [path], path);
  }

  /**
   * The terminal to use on Linux, or null: the desktop's own, else x-terminal-emulator (resolved to the
   * terminal behind it when it is one we know), else the first common one on PATH.
   */
  private async linuxTerminal(): Promise<{ term: LinuxTerminal; file: string } | null> {
    for (const term of linuxTerminalOrder(process.env.XDG_CURRENT_DESKTOP)) {
      const file = await this.resolve(term);
      if (!file) continue;
      if (term !== 'x-terminal-emulator') return { term, file };
      let real = file;
      try { real = realpathSync(file); } catch { /* keep the link */ }
      const behind = terminalBehind(real);
      const direct = behind === 'x-terminal-emulator' ? null : await this.resolve(behind);
      return direct ? { term: behind, file: direct } : { term, file };
    }
    return null;
  }

  private async openVsCode(path: string) {
    const exe = await this.vsCodePath();
    if (!exe) throw new ServiceUnavailableException('VS Code was not found. Install it and enable "Add to PATH".');
    if (IS_MAC && exe.endsWith('.app')) return launch('open', ['-a', exe, path], path);
    return launch(exe, [path], path);
  }

  /**
   * Opens a terminal in `path`, optionally running a program (an absolute executable path) in it. Fixed
   * arguments (`--resume <uuid>`) are always passed; the free-text prompt only where it arrives as one argument
   * untouched by a shell. Resolves to whether the prompt was passed (true when there was none).
   */
  private async openTerminal(path: string, run: TerminalRun | null): Promise<boolean> {
    const args = run?.args ?? [];
    if (IS_WIN) {
      const wt = await this.resolve('wt.exe');
      const textOk = !!run?.prompt && !!wt && !isBatchFile(run.program);
      const all = [...args, ...(textOk ? [windowsTerminalText(run!.prompt!)] : [])];
      // `-d .` + cwd keeps the folder out of wt's own argument parsing (which treats ';' specially).
      if (wt) await launch(wt, run ? ['-d', '.', run.program, ...all] : ['-d', '.'], path);
      // cmd.exe parses its whole command line, so only the fixed arguments go this way.
      else await launch('cmd.exe', run ? ['/c', 'start', '', run.program, ...args] : ['/c', 'start', '', 'cmd.exe'], path);
      return !run?.prompt || textOk;
    }
    if (IS_MAC) {
      const iterm = macApp('iTerm.app');
      if (!run) { await launch('open', ['-a', iterm ?? 'Terminal', path], path); return true; }
      // Every argument is shell-quoted by AppleScript's `quoted form of`.
      await launch('osascript', macClaudeArgs(path, run.program, !!iterm, [...args, ...(run.prompt ? [run.prompt] : [])]), path);
      return true;
    }
    const found = await this.linuxTerminal();
    if (!found) throw new ServiceUnavailableException('No terminal emulator found (GNOME Terminal, Konsole, xterm, …)');
    const textOk = !!run?.prompt && passesTextArgs(found.term);
    await launch(found.file, linuxTerminalArgs(found.term, path, run?.program ?? null, [...args, ...(textOk ? [run!.prompt!] : [])]), path);
    return !run?.prompt || textOk;
  }
}
