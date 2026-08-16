// Build the desktop bridge packages (host + client) from source.
// Neither package is a pnpm workspace member, so the repo build (pnpm run
// build) never rebuilds their lib/ and the repo install never creates their
// node_modules; the dev launcher (npm pack) and the runtime bake
// (bake-runtime.mjs) consume that output as-is. Run this before dev.mjs /
// bake-runtime.mjs whenever the bridge sources change — the desktop npm
// scripts wire it into both flows.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const tsc = resolve(repoRoot, 'node_modules/typescript/bin/tsc');
const tsdown = resolve(repoRoot, 'node_modules/tsdown/dist/run.mjs');

let failed = false;
for (const pkg of ['bridge', 'bridge-client']) {
  const dir = resolve(here, '..', pkg);
  // A fresh checkout has no node_modules for these standalone packages. The
  // host half resolves every import through its tsconfig paths and needs
  // nothing; the client half's tsc resolves react from node_modules, so a
  // missing install is restored from the registry (react and @types/react
  // are public packages) before the build runs.
  if (pkg === 'bridge-client' && !existsSync(join(dir, 'node_modules'))) {
    const install = spawnSync('npm', ['install', '--no-save', '--no-package-lock', '--ignore-scripts'], { cwd: dir, stdio: 'inherit', shell: process.platform === 'win32' });
    if (install.status !== 0) failed = true;
  }
  for (const [bin, args] of [[tsc, ['-p', 'tsconfig.json']], [tsdown, []]]) {
    const run = spawnSync(process.execPath, [bin, ...args], { cwd: dir, stdio: 'inherit' });
    if (run.status !== 0) failed = true;
  }
}
if (failed) {
  console.error('[build-bridge] bridge build failed');
  process.exit(1);
}
console.log('[build-bridge] bridge packages built');
