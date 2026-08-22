// Run the desktop release build for one validated target. Every preparatory
// script receives the same target so the sidecar, runtime, and Tauri command
// cannot silently select different platform bytes.
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveTargetFromArgs } from './target-spec.mjs';

const desktopRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = process.argv.slice(2);
const target = resolveTargetFromArgs(args);
const node = process.execPath;
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    cwd: desktopRoot,
    stdio: 'inherit',
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(node, ['scripts/sync-version.mjs']);
run(node, ['scripts/gen-icons.mjs', '--check']);
run(node, ['scripts/build-bridge.mjs']);
run(pnpm, ['exec', 'tsc', '-p', 'tsconfig.json']);
run(pnpm, ['exec', 'tsc', '-p', 'bridge-client/tsconfig.tests.json']);
run(pnpm, ['exec', 'vitest', '--config', 'bridge-client/vitest.config.ts', 'run']);
run(node, ['--test', 'scripts/target-spec.spec.mjs']);
run(node, ['--test', 'scripts/fetch-node-sidecar.spec.mjs']);
run(node, ['scripts/fetch-node-sidecar.mjs', '--target', target.rustTriple]);
run(node, ['scripts/bake-runtime.mjs', '--target', target.rustTriple]);
run(pnpm, ['exec', 'tauri', 'build', '--ci', '--target', target.rustTriple]);
