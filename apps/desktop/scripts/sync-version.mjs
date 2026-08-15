// Copy the canonical package.json version into tauri.conf.json. `tauri build`
// reads the app version from tauri.conf.json at compile time, so a version bump
// is a single edit in package.json; the next `bundle` (or `sync-version`)
// propagates it here, and the synced file is committed with the bump.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const version = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version;
const confPath = resolve(root, 'src-tauri', 'tauri.conf.json');
const conf = JSON.parse(readFileSync(confPath, 'utf8'));

if (conf.version === version) {
  process.exit(0);
}
conf.version = version;
writeFileSync(confPath, `${JSON.stringify(conf, null, 2)}\n`);
console.log(`[sync-version] tauri.conf.json version -> ${version}`);
