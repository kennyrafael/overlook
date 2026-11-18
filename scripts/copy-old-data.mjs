// One-off: copies data from the browser version (~/.claude-projects-dashboard) to the desktop
// app's data folder (%APPDATA%\Overlook on Windows, ~/Library/Application Support/Overlook on macOS).
// Close the desktop app first. Existing files in the destination are never overwritten.
// Usage: node scripts/copy-old-data.mjs
import { cpSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const from = join(homedir(), '.claude-projects-dashboard');
const to = process.platform === 'win32'
  ? join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'Overlook')
  : process.platform === 'darwin'
    ? join(homedir(), 'Library', 'Application Support', 'Overlook')
    : join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'Overlook');

if (!existsSync(from)) {
  console.log(`Nothing to copy: ${from} does not exist.`);
  process.exit(0);
}
if (existsSync(join(to, 'dashboard.sqlite'))) {
  console.error(`${join(to, 'dashboard.sqlite')} already exists. Not overwriting; remove it first if you want to replace it.`);
  process.exit(1);
}
cpSync(from, to, { recursive: true, force: false, errorOnExist: false });
console.log(`Copied ${from} → ${to}`);
