// Build the desktop bridge packages (host + client) from source.
// The packages are pnpm workspace members, but the repo build's explicit
// package globs do not include them. The dev launcher and runtime bake consume
// their lib/ output as-is, so run this before dev.mjs / bake-runtime.mjs
// whenever the bridge sources change.
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const tsc = resolve(repoRoot, 'node_modules/typescript/bin/tsc');
const tsdown = resolve(repoRoot, 'node_modules/tsdown/dist/run.mjs');

let failed = false;
for (const pkg of ['bridge', 'bridge-client']) {
  const dir = resolve(here, '..', pkg);
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
