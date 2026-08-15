// Dev launcher for the dsh-desktop shell: sets the dsh CLI path and runs the
// Tauri app through cargo. The production path (bundled Node sidecar +
// packaged CLI) is deferred; see README.md.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here, '../../cli/lib/bin.js');
const webDist = resolve(here, '../../web/dist/index.html');
const release = process.argv.includes('--release');

if (!existsSync(cli)) {
  console.error('[dsh-desktop] dsh CLI not built: expected ' + cli);
  console.error('  run at the repo root: pnpm run build:lib');
  process.exit(1);
}
if (!existsSync(webDist)) {
  console.error('[dsh-desktop] web frontend not built: expected ' + webDist);
  console.error('  run at the repo root: pnpm run build:web');
  process.exit(1);
}

const packDir = resolve(here, '../.bridge-pack');
mkdirSync(packDir, { recursive: true });
const env = {
  ...process.env,
  DSH_CLI: cli,
};
// Pack both bridge packages into tarballs; npm installs tarballs as real
// copies (folder installs symlink, which breaks runtime resolution).
for (const pkgDir of ['../bridge', '../bridge-client']) {
  const r = spawnSync('npm', ['pack', '--pack-destination', packDir], {
    cwd: resolve(here, pkgDir),
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (r.status !== 0) {
    console.error('[dsh-desktop] npm pack failed for ' + pkgDir + ': ' + (r.stderr || r.stdout));
    process.exit(1);
  }
  const tgz = r.stdout.trim().split(/\r?\n/).pop();
  env.DSH_BRIDGE_TARBALL = (env.DSH_BRIDGE_TARBALL ? env.DSH_BRIDGE_TARBALL + ';' : '') + resolve(packDir, tgz);
}
if (!process.env.DSH_NODE) {
  console.log('[dsh-desktop] using node from PATH; override with DSH_NODE');
}

const cargoArgs = [
  'run',
  '--manifest-path',
  resolve(here, '../src-tauri/Cargo.toml'),
  ...(release ? ['--release'] : []),
];
const child = spawn('cargo', cargoArgs, {
  env,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
child.on('exit', (code) => process.exit(code ?? 0));