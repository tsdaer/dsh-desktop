// Run the desktop release build for one validated target. Every preparatory
// script receives the same target so the sidecar, runtime, and Tauri command
// cannot silently select different platform bytes.
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveTargetFromArgs } from './target-spec.mjs';
import { effectiveTauriConfig, tauriBuildArgs } from './tauri-config.mjs';

const desktopRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = process.argv.slice(2);
const target = resolveTargetFromArgs(args);
const experimental = args.includes('--experimental');
if (experimental && target.productTarget !== 'macos-arm64') {
  throw new Error('--experimental is currently available only for the macOS arm64 build');
}
const targetConfig = experimental
  ? 'src-tauri/tauri.macos-arm64.experimental.conf.json'
  : target.tauriConfig;
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
effectiveTauriConfig(target, desktopRoot, targetConfig);
run(node, ['scripts/gen-icons.mjs', '--check']);
run(node, ['scripts/build-bridge.mjs']);
run(pnpm, ['exec', 'tsc', '-p', 'tsconfig.json']);
run(pnpm, ['exec', 'tsc', '-p', 'bridge-client/tsconfig.tests.json']);
run(pnpm, ['exec', 'vitest', '--config', 'bridge-client/vitest.config.ts', 'run']);
run(node, ['--test',
  'scripts/target-spec.spec.mjs',
  'scripts/fetch-node-sidecar.spec.mjs',
  'scripts/runtime-native.spec.mjs',
  'scripts/tauri-config.spec.mjs',
  'scripts/size-report.spec.mjs',
  'scripts/updater-manifest.spec.mjs',
  'scripts/release-artifacts.spec.mjs',
  'scripts/packaged-smoke.spec.mjs',
]);
run(node, ['scripts/fetch-node-sidecar.mjs', '--target', target.rustTriple]);
run(node, ['scripts/bake-runtime.mjs', '--target', target.rustTriple]);
run(pnpm, ['exec', 'tauri', 'build', ...tauriBuildArgs(target, desktopRoot, targetConfig)]);
