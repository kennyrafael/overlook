import { BadRequestException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { execFile, spawn } from 'child_process';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import type { ProjectAction } from '@overlook/shared';
import { PROJECT_ACTIONS } from '@overlook/shared';
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

/**
 * Opens a discovered project in local tools. Only the four whitelisted actions
 * exist, and only for folders the dashboard discovered itself.
 */
@Injectable()
export class ActionsService {
  private readonly log = new Logger(ActionsService.name);
  private resolved = new Map<string, string | null>();

  constructor(private projects: ProjectsService) {}

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

  private openFolder(path: string) {
    if (IS_WIN) return launch('explorer.exe', [path], path);
    if (IS_MAC) return launch('open', [path], path);
    return launch('xdg-open', [path], path);
  }

  private async openVsCode(path: string) {
    if (IS_WIN) {
      // `code` is a .cmd wrapper (needs a shell); start Code.exe next to it instead.
      const cmd = await this.require('code', 'VS Code (code)');
      const exe = join(dirname(dirname(cmd)), 'Code.exe');
      if (!existsSync(exe)) throw new ServiceUnavailableException(`VS Code executable not found next to ${cmd}`);
      return launch(exe, [path], path);
    }
    return launch(await this.require('code', 'VS Code (code)'), [path], path);
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
      if (program) throw new ServiceUnavailableException('Starting Claude in a terminal is only supported on Windows for now');
      return launch('open', ['-a', 'Terminal', path], path);
    }
    const term = (await this.resolve('x-terminal-emulator')) ?? (await this.resolve('gnome-terminal'));
    if (!term) throw new ServiceUnavailableException('No terminal emulator found');
    return launch(term, program ? ['-e', program] : [], path);
  }
}
