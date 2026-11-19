import { basename } from 'path';

/**
 * Linux terminal emulators "Open terminal" and "Start Claude Code" know how to drive. Each one gets the
 * folder and the program as separate argv entries (never a shell string), using its own options for the
 * working directory and for the command to run.
 */
export type LinuxTerminal =
  | 'gnome-terminal' | 'ptyxis' | 'konsole' | 'xfce4-terminal' | 'kitty' | 'alacritty' | 'xterm' | 'x-terminal-emulator';

/** Shown in Settings and setup ("Open terminal" uses …). */
export const LINUX_TERMINAL_LABEL: Record<LinuxTerminal, string> = {
  'gnome-terminal': 'GNOME Terminal',
  ptyxis: 'Ptyxis',
  konsole: 'Konsole',
  'xfce4-terminal': 'Xfce Terminal',
  kitty: 'kitty',
  alacritty: 'Alacritty',
  xterm: 'xterm',
  'x-terminal-emulator': 'terminal emulator',
};

const KNOWN = Object.keys(LINUX_TERMINAL_LABEL).filter((t) => t !== 'x-terminal-emulator') as LinuxTerminal[];

/**
 * Which terminals to try, best first: the desktop's own terminal (XDG_CURRENT_DESKTOP), then the
 * system default (Debian/Ubuntu's x-terminal-emulator), then the common ones.
 */
export function linuxTerminalOrder(desktop = ''): LinuxTerminal[] {
  const d = desktop.toUpperCase();
  const preferred: LinuxTerminal[] = d.includes('KDE') ? ['konsole']
    : d.includes('XFCE') ? ['xfce4-terminal']
    : /GNOME|UNITY|UBUNTU|BUDGIE|CINNAMON|PANTHEON/.test(d) ? ['gnome-terminal', 'ptyxis']
    : [];
  return [...new Set<LinuxTerminal>([...preferred, 'x-terminal-emulator', 'gnome-terminal', 'ptyxis', 'konsole', 'xfce4-terminal', 'kitty', 'alacritty', 'xterm'])];
}

/**
 * x-terminal-emulator is a link (via /etc/alternatives) to the real terminal or its Debian wrapper, e.g.
 * /usr/bin/gnome-terminal.wrapper. When that is a terminal we know, use it directly with its own options
 * (the wrappers re-split a single -e argument on spaces); otherwise keep the generic x-terminal-emulator.
 */
export function terminalBehind(realPath: string): LinuxTerminal {
  const name = basename(realPath).replace(/\.wrapper$/, '').replace(/\.real$/, '');
  return (KNOWN as string[]).includes(name) ? (name as LinuxTerminal) : 'x-terminal-emulator';
}

/**
 * Arguments that open `term` in `dir`, running `program` (an absolute path) when given. The process is
 * also started with `dir` as its cwd, which is all xterm and the generic x-terminal-emulator can use.
 * `dir` is an absolute path, so it can never be read as an option.
 */
export function linuxTerminalArgs(term: LinuxTerminal, dir: string, program: string | null): string[] {
  const run = (flag: string | null) => (program ? (flag ? [flag, program] : [program]) : []);
  switch (term) {
    case 'gnome-terminal': return [`--working-directory=${dir}`, ...run('--')];
    case 'ptyxis': return ['--new-window', `--working-directory=${dir}`, ...run('--')];
    case 'konsole': return ['--workdir', dir, ...run('-e')];
    case 'xfce4-terminal': return [`--working-directory=${dir}`, ...run('-x')];
    case 'kitty': return ['--directory', dir, ...run(null)];
    case 'alacritty': return ['--working-directory', dir, ...run('-e')];
    case 'xterm': return run('-e');
    case 'x-terminal-emulator': return run('-e');
  }
}
