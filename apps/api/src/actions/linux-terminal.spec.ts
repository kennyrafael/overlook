import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LINUX_TERMINAL_LABEL, linuxTerminalArgs, linuxTerminalOrder, passesTextArgs, terminalBehind, type LinuxTerminal } from './linux-terminal';

const evil = `/home/me/it's "quoted" $(rm -rf ~); x && echo; -e --x`;
const claude = '/home/me/.local/bin/claude';
const ALL = Object.keys(LINUX_TERMINAL_LABEL) as LinuxTerminal[];

for (const term of ALL) {
  test(`Linux ${term}: the folder and program are whole argv entries, never a shell string`, () => {
    for (const program of [claude, null]) {
      const args = linuxTerminalArgs(term, evil, program);
      // The folder appears at most once, unchanged, either alone or as the value of a --flag=… option.
      const folderArgs = args.filter((a) => a.includes(evil));
      assert.ok(folderArgs.length <= 1);
      if (folderArgs[0]) assert.ok(folderArgs[0] === evil || /^--[\w-]+=/.test(folderArgs[0]) && folderArgs[0].endsWith(`=${evil}`), folderArgs[0]);
      // Nothing is wrapped in a shell.
      assert.ok(!args.some((a) => /^(ba|z|da)?sh$|^-c$/.test(a)), args.join(' '));
      if (program) {
        // The program is the last entry, by itself, after the terminal's "run this" option (if any).
        assert.equal(args.at(-1), program);
        assert.equal(args.filter((a) => a.includes(program)).length, 1);
      } else {
        assert.ok(!args.includes('-e') && !args.includes('--') && !args.includes('-x'));
      }
    }
  });
}

test('Linux terminals use their own working-directory and command options', () => {
  assert.deepEqual(linuxTerminalArgs('gnome-terminal', '/p', claude), ['--working-directory=/p', '--', claude]);
  assert.deepEqual(linuxTerminalArgs('ptyxis', '/p', claude), ['--new-window', '--working-directory=/p', '--', claude]);
  assert.deepEqual(linuxTerminalArgs('konsole', '/p', claude), ['--workdir', '/p', '-e', claude]);
  assert.deepEqual(linuxTerminalArgs('xfce4-terminal', '/p', claude), ['--working-directory=/p', '-x', claude]);
  assert.deepEqual(linuxTerminalArgs('kitty', '/p', claude), ['--directory', '/p', claude]);
  assert.deepEqual(linuxTerminalArgs('alacritty', '/p', claude), ['--working-directory', '/p', '-e', claude]);
  // xterm and the generic x-terminal-emulator only get the folder as the process's cwd.
  assert.deepEqual(linuxTerminalArgs('xterm', '/p', claude), ['-e', claude]);
  assert.deepEqual(linuxTerminalArgs('x-terminal-emulator', '/p', null), []);
  assert.deepEqual(linuxTerminalArgs('gnome-terminal', '/p', null), ['--working-directory=/p']);
});

test('the desktop\'s own terminal comes first, then x-terminal-emulator, then the common ones', () => {
  assert.deepEqual(linuxTerminalOrder('KDE').slice(0, 2), ['konsole', 'x-terminal-emulator']);
  assert.deepEqual(linuxTerminalOrder('ubuntu:GNOME').slice(0, 3), ['gnome-terminal', 'ptyxis', 'x-terminal-emulator']);
  assert.deepEqual(linuxTerminalOrder('XFCE').slice(0, 2), ['xfce4-terminal', 'x-terminal-emulator']);
  const plain = linuxTerminalOrder('');
  assert.equal(plain[0], 'x-terminal-emulator');
  assert.equal(new Set(plain).size, plain.length);
  assert.deepEqual([...plain].sort(), [...ALL].sort());
});

test('x-terminal-emulator is resolved to the terminal behind it when it is a known one', () => {
  assert.equal(terminalBehind('/usr/bin/gnome-terminal.wrapper'), 'gnome-terminal');
  assert.equal(terminalBehind('/usr/bin/konsole'), 'konsole');
  assert.equal(terminalBehind('/usr/bin/xfce4-terminal.wrapper'), 'xfce4-terminal');
  assert.equal(terminalBehind('/usr/bin/terminator'), 'x-terminal-emulator');
  assert.equal(terminalBehind('/usr/bin/x-terminal-emulator'), 'x-terminal-emulator');
});

test('extra program arguments follow the program, unchanged', () => {
  const prompt = `Work on: it's "x" $(rm -rf ~); y`;
  assert.deepEqual(linuxTerminalArgs('gnome-terminal', '/p', claude, ['--resume', 'id']), ['--working-directory=/p', '--', claude, '--resume', 'id']);
  assert.deepEqual(linuxTerminalArgs('konsole', '/p', claude, [prompt]), ['--workdir', '/p', '-e', claude, prompt]);
  assert.deepEqual(linuxTerminalArgs('kitty', '/p', claude, [prompt]), ['--directory', '/p', claude, prompt]);
  assert.deepEqual(linuxTerminalArgs('xterm', '/p', claude, [prompt]), ['-e', claude, prompt]);
  assert.deepEqual(linuxTerminalArgs('gnome-terminal', '/p', null, [prompt]), ['--working-directory=/p']);
});

test('free text is not handed to the generic x-terminal-emulator, which re-splits on spaces', () => {
  assert.equal(passesTextArgs('x-terminal-emulator'), false);
  for (const t of ['gnome-terminal', 'ptyxis', 'konsole', 'xfce4-terminal', 'kitty', 'alacritty', 'xterm'] as const) assert.equal(passesTextArgs(t), true);
});
