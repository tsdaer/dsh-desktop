import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  descendantPids,
  dmgInstallArguments,
  dmgMountArguments,
  macosInstallRoot,
  nsisUninstallArguments,
  managedProcessPids,
  packagedRuntime,
  packagedExecutable,
  processCommandIncludesExecutable,
  observeUpdateVersion,
  resolveInstalledDebRuntime,
  parseArguments,
  parseProcessSnapshot,
  assertUserDataRetained,
  run,
  removeTemporaryHome,
  splashLogDiagnostics,
  stopChildWithEscalation,
  terminalSmokeCommand,
} from './packaged-smoke.mjs';

test('requires a target-native package artifact for the packaged smoke', () => {
  assert.equal(parseArguments([
    '--target', 'x86_64-unknown-linux-gnu', '--artifact', 'dist/dsh.AppImage', '--terminal-smoke',
  ]).terminalSmoke, true);
  assert.equal(parseArguments([
    '--target', 'x86_64-unknown-linux-gnu', '--artifact', 'dist/dsh.deb', '--install-deb',
  ]).installDeb, true);
  assert.equal(parseArguments([
    '--target', 'x86_64-unknown-linux-gnu', '--artifact', 'dist/dsh.AppImage', '--web-smoke',
  ]).webSmoke, true);
  assert.deepEqual(
    parseArguments([
      '--target', 'x86_64-unknown-linux-gnu', '--artifact', 'dist/dsh.AppImage',
      '--update-smoke', '--expected-version', '0.3.5',
    ]).expectedVersion,
    '0.3.5',
  );
  assert.throws(
    () => parseArguments([
      '--target', 'x86_64-unknown-linux-gnu', '--artifact', 'dist/dsh.AppImage', '--update-smoke',
    ]), /requires --expected-version/,
  );
  assert.throws(
    () => parseArguments([
      '--target', 'x86_64-unknown-linux-gnu', '--artifact', 'dist/dsh.AppImage', '--expected-version', '0.3.5',
    ]), /requires --update-smoke/,
  );
  assert.deepEqual(observeUpdateVersion(false, '0.3.4', '0.3.5'), {
    sawInitialVersion: true,
    complete: false,
  });
  assert.deepEqual(observeUpdateVersion(true, '0.3.5', '0.3.5'), {
    sawInitialVersion: true,
    complete: true,
  });
  assert.deepEqual(observeUpdateVersion(false, '0.3.5', '0.3.5'), {
    sawInitialVersion: false,
    complete: false,
  });
  assert.throws(
    () => parseArguments(['--target', 'x86_64-pc-windows-msvc', '--artifact', 'dsh.exe']),
    /requires --install-nsis/,
  );
  assert.equal(parseArguments([
    '--target', 'x86_64-pc-windows-msvc', '--artifact', 'dist/dsh-desktop.exe', '--install-nsis',
  ]).installNsis, true);
  assert.throws(
    () => parseArguments(['--target', 'x86_64-pc-windows-msvc', '--artifact', 'dsh.msi', '--install-nsis']),
    /expected a \.exe artifact/,
  );
  assert.throws(
    () => parseArguments(['--target', 'x86_64-unknown-linux-gnu', '--artifact', 'dsh.deb']),
    /expected a \.AppImage artifact/,
  );
  assert.equal(parseArguments([
    '--target', 'aarch64-apple-darwin', '--artifact', 'dist/dsh-desktop.app',
  ]).installDmg, false);
  assert.equal(parseArguments([
    '--target', 'aarch64-apple-darwin', '--artifact', 'dist/dsh-desktop.dmg', '--install-dmg',
  ]).installDmg, true);
  assert.throws(
    () => parseArguments([
      '--target', 'aarch64-apple-darwin', '--artifact', 'dist/dsh.deb', '--install-deb',
    ]),
    /only available for Linux x64/,
  );
  assert.throws(
    () => parseArguments([
      '--target', 'aarch64-apple-darwin', '--artifact', 'dist/dsh-desktop.app', '--web-smoke',
    ]),
    /only available for Linux x64/,
  );
  assert.throws(
    () => parseArguments([
      '--target', 'aarch64-apple-darwin', '--artifact', 'dist/dsh.dmg', '--install-deb', '--install-dmg',
    ]),
    /mutually exclusive/,
  );
});

test('reports an isolated native splash log after startup failure', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-splash-log-test-'));
  try {
    assert.equal(splashLogDiagnostics(root), '');
    writeFileSync(join(root, 'dsh-desktop-splash.log'), 'boot: waiting\n');
    assert.equal(
      splashLogDiagnostics(root),
      '\n[packaged-smoke] native splash log:\nboot: waiting\n',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('resolves the macOS installation root before launch', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-macos-install-root-test-'));
  try {
    const physical = join(root, 'physical');
    const alias = join(root, 'alias');
    mkdirSync(physical);
    symlinkSync(physical, alias, 'junction');
    assert.equal(macosInstallRoot(alias), realpathSync(physical));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('accepts inherited stdio for installer commands', () => {
  assert.equal(run(process.execPath, ['-e', 'process.stdout.write(\'\')'], { stdio: 'inherit' }), '');
});

test('captures installed package inventories beyond the child process default buffer', () => {
  const bytes = 2 * 1024 * 1024;
  assert.equal(
    run(process.execPath, ['-e', `process.stdout.write('x'.repeat(${bytes}))`]).length,
    bytes,
  );
});

test('uses a shell-native terminal marker command', () => {
  assert.equal(terminalSmokeCommand('win32'), 'echo dsh-desktop-terminal-smoke');
  assert.equal(terminalSmokeCommand('linux'), 'printf dsh-desktop-terminal-smoke');
  assert.equal(terminalSmokeCommand('darwin'), 'printf dsh-desktop-terminal-smoke');
});

test('resolves the executable inside target-native packages and app bundles', () => {
  assert.equal(
    packagedExecutable('C:/dsh-desktop', { productTarget: 'windows-x64' }),
    join('C:/dsh-desktop', 'dsh-desktop.exe'),
  );
  assert.equal(
    packagedExecutable('/tmp/squashfs-root', { productTarget: 'linux-x64' }),
    join('/tmp/squashfs-root', 'AppRun'),
  );
  assert.equal(
    packagedExecutable('/tmp/dsh-desktop.app', { productTarget: 'macos-arm64' }),
    join('/tmp/dsh-desktop.app', 'Contents', 'MacOS', 'dsh-desktop'),
  );
  assert.deepEqual(
    dmgMountArguments('/tmp/dsh.dmg', '/tmp/mount'),
    ['attach', '-nobrowse', '-readonly', '-mountpoint', '/tmp/mount', '/tmp/dsh.dmg'],
  );
  assert.deepEqual(
    dmgInstallArguments('/tmp/mount/dsh-desktop.app', '/tmp/installed/dsh-desktop.app'),
    ['--noqtn', '/tmp/mount/dsh-desktop.app', '/tmp/installed/dsh-desktop.app'],
  );
  assert.deepEqual(
    nsisUninstallArguments('C:\\Temp\\dsh desktop'),
    ['/S', '_?=C:\\Temp\\dsh desktop'],
  );
});

test('finds all runtime descendants from an immutable process snapshot', () => {
  const descendants = descendantPids([
    { pid: 20, parent: 10 },
    { pid: 30, parent: 20 },
    { pid: 40, parent: 30 },
    { pid: 50, parent: 999 },
  ], 10);
  assert.deepEqual([...descendants].sort((a, b) => a - b), [20, 30, 40]);
});

test('keeps command lines so re-parented sidecars remain observable', () => {
  const processes = parseProcessSnapshot([
    '  10   1 /opt/dsh-desktop/usr/bin/dsh-desktop',
    '  20  10 /opt/dsh-desktop/usr/lib/dsh-desktop/dsh-node runtime/lib/bin.js',
    '  30   1 /usr/bin/node unrelated.js',
    '  40   1 /opt/dsh-desktop/usr/lib/dsh-desktop/dsh-node-copy unrelated.js',
  ].join('\n'));
  assert.deepEqual(processes, [
    { pid: 10, parent: 1, command: '/opt/dsh-desktop/usr/bin/dsh-desktop' },
    {
      pid: 20,
      parent: 10,
      command: '/opt/dsh-desktop/usr/lib/dsh-desktop/dsh-node runtime/lib/bin.js',
    },
    { pid: 30, parent: 1, command: '/usr/bin/node unrelated.js' },
    { pid: 40, parent: 1, command: '/opt/dsh-desktop/usr/lib/dsh-desktop/dsh-node-copy unrelated.js' },
  ]);
  assert.deepEqual(
    [...managedProcessPids(processes, 10, '/opt/dsh-desktop/usr/lib/dsh-desktop/dsh-node')].sort((a, b) => a - b),
    [10, 20],
  );
  assert.equal(
    processCommandIncludesExecutable(
      '"C:\\Temp\\DSH Desktop\\dsh-node.exe" runtime\\lib\\bin.js',
      'c:/temp/dsh desktop/dsh-node.exe',
    ),
    true,
  );
});

test('locates exactly one target sidecar and runtime inside an extracted package', () => {
  const root = join(tmpdir(), `dsh-packaged-runtime-${process.pid}-${Date.now()}`);
  try {
    const runtime = join(root, 'usr', 'lib', 'dsh-desktop', 'runtime');
    mkdirSync(join(runtime, 'lib'), { recursive: true });
    mkdirSync(join(root, 'usr', 'lib', 'dsh-desktop', 'binaries'), { recursive: true });
    writeFileSync(join(runtime, 'lib', 'bin.js'), '');
    const sidecar = join(root, 'usr', 'lib', 'dsh-desktop', 'binaries', 'dsh-node');
    writeFileSync(sidecar, '');
    assert.deepEqual(
      packagedRuntime(root, { packagedSidecarBasename: 'dsh-node' }),
      { sidecar, runtime },
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('resolves the sidecar and runtime from the files installed by a deb package', () => {
  const runtime = resolveInstalledDebRuntime([
    '/usr/bin/dsh-desktop',
    '/usr/bin/dsh-node',
    '/usr/lib/dsh-desktop/runtime/lib/bin.js',
  ], { packagedSidecarBasename: 'dsh-node' });
  assert.deepEqual(runtime, {
    sidecar: '/usr/bin/dsh-node',
    runtime: '/usr/lib/dsh-desktop/runtime',
  });
  assert.throws(
    () => resolveInstalledDebRuntime([
      '/usr/lib/dsh-desktop/runtime/lib/bin.js',
      '/usr/bin/dsh-node',
      '/opt/dsh-node',
    ], { packagedSidecarBasename: 'dsh-node' }),
    /expected one installed sidecar/,
  );
});

test('requires user-owned data to survive package removal', () => {
  const home = join(tmpdir(), `dsh-packaged-home-${process.pid}-${Date.now()}`);
  const marker = join(home, 'desktop-smoke-user-data.marker');
  try {
    mkdirSync(home, { recursive: true });
    writeFileSync(marker, 'retained\n');
    assert.doesNotThrow(() => assertUserDataRetained(home, marker));
    rmSync(marker);
    assert.throws(() => assertUserDataRetained(home, marker), /user data marker was removed/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('retries temporary-home removal while Windows releases installer handles', () => {
  const calls = [];
  removeTemporaryHome('C:/Temp/dsh-smoke', (path, options) => calls.push({ path, options }));
  assert.deepEqual(calls, [{
    path: 'C:/Temp/dsh-smoke',
    options: { recursive: true, force: true, maxRetries: 20, retryDelay: 250 },
  }]);
});

test('accepts forced shutdown after a bounded graceful attempt', async () => {
  const signals = [];
  const waits = [];
  await stopChildWithEscalation({}, {
    stop: (_child, signal) => signals.push(signal),
    wait: async (_child, timeout) => {
      waits.push(timeout);
      if (waits.length === 1) throw new Error('graceful timeout');
    },
  });
  assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
  assert.deepEqual(waits, [10_000, 2_000]);

  await assert.rejects(
    stopChildWithEscalation({}, {
      stop: () => {},
      wait: async () => { throw new Error('still running'); },
    }),
    /did not exit after forced shutdown/,
  );
});

test('rejects a package without the target sidecar', () => {
  const root = join(tmpdir(), `dsh-packaged-runtime-invalid-${process.pid}-${Date.now()}`);
  try {
    assert.throws(
      () => packagedRuntime(root, { packagedSidecarBasename: 'dsh-node' }),
      /expected one packaged sidecar/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
