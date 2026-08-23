import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  descendantPids,
  dmgMountArguments,
  managedProcessPids,
  packagedRuntime,
  packagedExecutable,
  observeUpdateVersion,
  resolveInstalledDebPackageRoot,
  parseArguments,
  parseProcessSnapshot,
  assertUserDataRetained,
} from './packaged-smoke.mjs';

test('requires a target-native package artifact for the packaged smoke', () => {
  assert.equal(parseArguments([
    '--target', 'x86_64-unknown-linux-gnu', '--artifact', 'dist/dsh.AppImage', '--terminal-smoke',
  ]).terminalSmoke, true);
  assert.equal(parseArguments([
    '--target', 'x86_64-unknown-linux-gnu', '--artifact', 'dist/dsh.deb', '--install-deb',
  ]).installDeb, true);
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
      '--target', 'aarch64-apple-darwin', '--artifact', 'dist/dsh.dmg', '--install-deb', '--install-dmg',
    ]),
    /mutually exclusive/,
  );
});

test('resolves the executable inside target-native packages and app bundles', () => {
  assert.equal(
    packagedExecutable('C:/dsh-desktop', { productTarget: 'windows-x64' }),
    join('C:/dsh-desktop', 'dsh-desktop.exe'),
  );
  assert.equal(
    packagedExecutable('/tmp/squashfs-root', { productTarget: 'linux-x64' }),
    join('/tmp/squashfs-root', 'usr', 'bin', 'dsh-desktop'),
  );
  assert.equal(
    packagedExecutable('/tmp/dsh-desktop.app', { productTarget: 'macos-arm64' }),
    join('/tmp/dsh-desktop.app', 'Contents', 'MacOS', 'dsh-desktop'),
  );
  assert.deepEqual(
    dmgMountArguments('/tmp/dsh.dmg', '/tmp/mount'),
    ['attach', '-nobrowse', '-readonly', '-mountpoint', '/tmp/mount', '/tmp/dsh.dmg'],
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
    '  20  10 /opt/dsh-desktop/usr/lib/dsh-desktop/node-x86_64-unknown-linux-gnu runtime/lib/bin.js',
    '  30   1 /usr/bin/node unrelated.js',
  ].join('\n'));
  assert.deepEqual(processes, [
    { pid: 10, parent: 1, command: '/opt/dsh-desktop/usr/bin/dsh-desktop' },
    {
      pid: 20,
      parent: 10,
      command: '/opt/dsh-desktop/usr/lib/dsh-desktop/node-x86_64-unknown-linux-gnu runtime/lib/bin.js',
    },
    { pid: 30, parent: 1, command: '/usr/bin/node unrelated.js' },
  ]);
  assert.deepEqual(
    [...managedProcessPids(processes, 10, 'node-x86_64-unknown-linux-gnu')].sort((a, b) => a - b),
    [10, 20],
  );
});

test('locates exactly one target sidecar and runtime inside an extracted package', () => {
  const root = join(tmpdir(), `dsh-packaged-runtime-${process.pid}-${Date.now()}`);
  try {
    const runtime = join(root, 'usr', 'lib', 'dsh-desktop', 'runtime');
    mkdirSync(join(runtime, 'lib'), { recursive: true });
    mkdirSync(join(root, 'usr', 'lib', 'dsh-desktop', 'binaries'), { recursive: true });
    writeFileSync(join(runtime, 'lib', 'bin.js'), '');
    const sidecar = join(root, 'usr', 'lib', 'dsh-desktop', 'binaries', 'node-x86_64-unknown-linux-gnu');
    writeFileSync(sidecar, '');
    assert.deepEqual(
      packagedRuntime(root, { sidecarBasename: 'node-x86_64-unknown-linux-gnu' }),
      { sidecar, runtime },
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('resolves the runtime root from the files installed by a deb package', () => {
  const root = resolveInstalledDebPackageRoot([
    '/usr/bin/dsh-desktop',
    '/usr/lib/dsh-desktop/binaries/node-x86_64-unknown-linux-gnu',
    '/usr/lib/dsh-desktop/runtime/lib/bin.js',
  ], { sidecarBasename: 'node-x86_64-unknown-linux-gnu' });
  assert.equal(root, '/usr/lib/dsh-desktop');
  assert.throws(
    () => resolveInstalledDebPackageRoot([
      '/usr/lib/dsh-desktop/runtime/lib/bin.js',
      '/opt/node-x86_64-unknown-linux-gnu',
    ], { sidecarBasename: 'node-x86_64-unknown-linux-gnu' }),
    /outside the desktop resource root/,
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

test('rejects a package without the target sidecar', () => {
  const root = join(tmpdir(), `dsh-packaged-runtime-invalid-${process.pid}-${Date.now()}`);
  try {
    assert.throws(
      () => packagedRuntime(root, { sidecarBasename: 'node-x86_64-unknown-linux-gnu' }),
      /expected one packaged sidecar/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
