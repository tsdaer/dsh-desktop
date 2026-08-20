// Keep every desktop version source equal to the canonical package.json value.
// `tauri build` reads tauri.conf.json and Cargo.toml at compile time, and the
// release workflow refuses a tag whose sources disagree, so a version bump stays
// a single edit in package.json that this script propagates.
//
// Cargo.lock carries the crate's own version too. Cargo rewrites it on the next
// build, which silently leaves a committed lockfile behind the tag it shipped
// under; syncing it here keeps the committed tree consistent without requiring
// a network-capable cargo run.
//
// Pass --check to verify agreement without writing (used by the release
// workflow); the default form writes each stale target.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CRATE = 'dsh-desktop';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const check = process.argv.includes('--check');
const version = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version;

/**
 * Replace the crate's own `version` line inside Cargo.lock, leaving every
 * dependency entry untouched.
 * @param text - the complete Cargo.lock contents.
 * @param next - the version to record.
 * @returns the updated contents.
 */
function setLockVersion(text, next) {
  return text.replace(
    new RegExp(`(\\[\\[package\\]\\]\\nname = "${CRATE}"\\nversion = ")[^"]+(")`),
    `$1${next}$2`,
  );
}

const targets = [
  {
    label: 'tauri.conf.json',
    path: resolve(root, 'src-tauri', 'tauri.conf.json'),
    read: text => JSON.parse(text).version,
    write: (text, next) => `${JSON.stringify({ ...JSON.parse(text), version: next }, null, 2)}\n`,
  },
  {
    label: 'Cargo.toml',
    // The package version is the only top-level `version =` line; dependency
    // versions live inside inline tables and never start a line.
    path: resolve(root, 'src-tauri', 'Cargo.toml'),
    read: text => text.match(/^version = "([^"]+)"/m)?.[1],
    write: (text, next) => text.replace(/^version = "[^"]+"/m, `version = "${next}"`),
  },
  {
    label: 'Cargo.lock',
    path: resolve(root, 'src-tauri', 'Cargo.lock'),
    read: text => text.match(new RegExp(`\\[\\[package\\]\\]\\nname = "${CRATE}"\\nversion = "([^"]+)"`))?.[1],
    write: setLockVersion,
  },
];

const stale = [];
for (const target of targets) {
  const text = readFileSync(target.path, 'utf8');
  const found = target.read(text);
  if (found === version) {
    continue;
  }
  if (found === undefined) {
    throw new Error(`[sync-version] ${target.label} declares no ${CRATE} version to compare against ${version}`);
  }
  stale.push({ label: target.label, found });
  if (!check) {
    writeFileSync(target.path, target.write(text, version));
    console.log(`[sync-version] ${target.label} version ${found} -> ${version}`);
  }
}

if (check && stale.length > 0) {
  const detail = stale.map(entry => `${entry.label}=${entry.found}`).join(', ');
  console.error(`[sync-version] desktop versions disagree with package.json=${version}: ${detail}`);
  process.exit(1);
}
if (check) {
  console.log(`[sync-version] ${targets.length} version source(s) agree on ${version}`);
}
