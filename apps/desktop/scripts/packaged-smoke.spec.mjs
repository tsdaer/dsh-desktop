import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';

import {
  descendantPids,
  dmgMountArguments,
  managedProcessPids,
  packagedExecutable,
  parseArguments,
  parseProcessSnapshot,
} from './packaged-smoke.mjs';

test('requires a target-native package artifact for the packaged smoke', () => {
  assert.equal(parseArguments([
    '--target', 'x86_64-unknown-linux-gnu', '--artifact', 'dist/dsh.AppImage',
  ]).installDeb, false);
  assert.equal(parseArguments([
    '--target', 'x86_64-unknown-linux-gnu', '--artifact', 'dist/dsh.deb', '--install-deb',
  ]).installDeb, true);
  assert.throws(
    () => parseArguments(['--target', 'x86_64-pc-windows-msvc', '--artifact', 'dsh.exe']),
    /Linux x64 and macOS arm64 only/,
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

test('resolves the executable inside Linux packages and macOS app bundles', () => {
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
