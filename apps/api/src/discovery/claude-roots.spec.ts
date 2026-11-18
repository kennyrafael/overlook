import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { wslRootsIn, wslToWindows } from './claude-roots';

const IS_WIN = process.platform === 'win32';

test('maps WSL paths to Windows paths', { skip: !IS_WIN && 'Windows path mapping' }, () => {
  const distro = '\\\\wsl.localhost\\Ubuntu';
  assert.equal(wslToWindows('/home/kim/code/app', distro), '\\\\wsl.localhost\\Ubuntu\\home\\kim\\code\\app');
  assert.equal(wslToWindows('/home/kim/code/app/', distro), '\\\\wsl.localhost\\Ubuntu\\home\\kim\\code\\app');
  // Windows drives mounted inside WSL map back to the drive itself.
  assert.equal(wslToWindows('/mnt/c/Users/kim/app', distro), 'C:\\Users\\kim\\app');
  assert.equal(wslToWindows('/mnt/d', distro), 'D:\\');
});

test('finds Claude history for each user inside a distro', () => {
  const base = mkdtempSync(join(tmpdir(), 'cpd-wsl-'));
  try {
    mkdirSync(join(base, 'home', 'kim', '.claude', 'projects'), { recursive: true });
    mkdirSync(join(base, 'home', 'sam'), { recursive: true }); // no Claude history
    mkdirSync(join(base, 'root', '.claude', 'projects'), { recursive: true });
    const roots = wslRootsIn('Ubuntu', base);
    assert.deepEqual(roots.map((r) => r.dir).sort(), [
      join(base, 'home', 'kim', '.claude', 'projects'),
      join(base, 'root', '.claude', 'projects'),
    ].sort());
    assert.ok(roots.every((r) => r.label === 'WSL: Ubuntu'));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('a distro without /home or Claude history yields no roots', () => {
  const base = mkdtempSync(join(tmpdir(), 'cpd-wsl-'));
  try {
    assert.deepEqual(wslRootsIn('Empty', base), []);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
