import { BadRequestException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { execFile, spawn } from 'child_process';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';
import type { ProjectAction, SystemTools } from '@overlook/shared';
import { PROJECT_ACTIONS } from '@overlook/shared';
import { SettingsService } from '../config/settings.service';
import { claudeRoots } from '../discovery/claude-roots';
import { ProjectsService } from '../projects/projects.service';

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';

function which(cmd: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(IS_WIN ? 'where.exe' : 'which', [cmd], { windowsHide: true }, (err, out) => {
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
const MAC_TERMINAL_SCRIPT = [
  'on run argv',
  '  set cmd to "cd " & quoted form of (item 1 of argv) & " && " & quoted form of (item 2 of argv)',
  '  tell application "Terminal"',
  '    activate',
  '    do script cmd',
  '  end tell',
  'end run',
];
const MAC_ITERM_SCRIPT = [
  'on run argv',
  '  set cmd to "cd " & quoted form of (item 1 of argv) & " && " & quoted form of (item 2 of argv)',
  '  tell application "iTerm"',
  '    activate',
  '    set w to (create window with default profile)',
  '    tell current session of w to write text cmd',
  '  end tell',
  'end run',
];
/** `osascript` arguments that open Terminal (or iTerm) at `path` and run `program` there. */
export function macClaudeArgs(path: string, program: string, iterm: boolean): string[] {
  return [...(iterm ? MAC_ITERM_SCRIPT : MAC_TERMINAL_SCRIPT).flatMap((l) => ['-e', l]), path, program];
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
    const [git, claude, vscode, wt, roots] = await Promise.all([
      this.resolve('git'),
      this.resolve('claude'),
      this.vsCodePath(),
      IS_WIN ? this.resolve('wt.exe') : Promise.resolve(null),
      this.settings.get().then((s) => claudeRoots(s.useWsl)),
    ]);
    const terminal: SystemTools['terminal'] = IS_WIN ? (wt ? 'Windows Terminal' : 'Command Prompt')
      : IS_MAC ? (macApp('iTerm.app') ? 'iTerm' : 'Terminal')
      : (await this.resolve('x-terminal-emulator')) ?? (await this.resolve('gnome-terminal')) ? 'terminal emulator' : null;
    const present = roots.filter((r) => existsSync(r.dir));
    return {
      platform: process.platform,
      git: !!git,
      claude: !!claude,
      vscode: !!vscode,
      terminal,
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

  async run(projectId: string, action: string): Promise<{ ok: true; action: ProjectAction }> {
    if (!PROJECT_ACTIONS.includes(action as ProjectAction)) throw new BadRequestException(`Unknown action ${action}`);
    const ref = (await this.projects.refs()).find((r) => r.id === projectId);
    if (!ref) throw new NotFoundException(`Project ${projectId} not found`);
    if (!ref.exists || !existsSync(ref.path)) throw new NotFoundException('The project folder no longer exists');

    const a = action as ProjectAction;
    try {
      if (a === 'explorer') await this.openFolder(ref.path);
      else if (a === 'vscode') await this.openVsCode(ref.path);
      else if (a === 'terminal') await this.openTerminal(ref.path, null);
      else if (a === 'claude') await this.openTerminal(ref.path, await this.require('claude', 'Claude Code (claude)'));
    } catch (e) {
      if (e instanceof ServiceUnavailableException) throw e;
      this.log.warn(`${a} failed for ${ref.path}: ${e}`);
      throw new ServiceUnavailableException(`Could not start ${a}: ${e instanceof Error ? e.message : e}`);
    }
    this.log.log(`${a} → ${ref.path}`);
    return { ok: true, action: a };
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

  openFolder(path: string) {
    if (IS_WIN) return launch('explorer.exe', [path], path);
    if (IS_MAC) return launch('open', [path], path);
    return launch('xdg-open', [path], path);
  }

  private async openVsCode(path: string) {
    const exe = await this.vsCodePath();
    if (!exe) throw new ServiceUnavailableException('VS Code was not found. Install it and enable "Add to PATH".');
    if (IS_MAC && exe.endsWith('.app')) return launch('open', ['-a', exe, path], path);
    return launch(exe, [path], path);
  }

  /** Opens a terminal in `path`, optionally running `program` (an absolute executable path) in it. */
  private async openTerminal(path: string, program: string | null) {
    if (IS_WIN) {
      const wt = await this.resolve('wt.exe');
      // `-d .` + cwd keeps the folder out of wt's own argument parsing (which treats ';' specially).
      if (wt) return launch(wt, program ? ['-d', '.', program] : ['-d', '.'], path);
      return launch('cmd.exe', program ? ['/c', 'start', '', program] : ['/c', 'start', '', 'cmd.exe'], path);
    }
    if (IS_MAC) {
      const iterm = macApp('iTerm.app');
      if (!program) return launch('open', ['-a', iterm ?? 'Terminal', path], path);
      return launch('osascript', macClaudeArgs(path, program, !!iterm), path);
    }
    const term = (await this.resolve('x-terminal-emulator')) ?? (await this.resolve('gnome-terminal'));
    if (!term) throw new ServiceUnavailableException('No terminal emulator found');
    return launch(term, program ? ['-e', program] : [], path);
  }
}
