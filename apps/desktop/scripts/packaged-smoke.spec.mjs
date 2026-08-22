import assert from 'node:assert/strict';
import test from 'node:test';

import { descendantPids, parseArguments } from './packaged-smoke.mjs';

test('requires a Linux AppImage or deb artifact for the packaged smoke', () => {
  assert.equal(parseArguments([
    '--target', 'x86_64-unknown-linux-gnu', '--artifact', 'dist/dsh.AppImage',
  ]).installDeb, false);
  assert.equal(parseArguments([
    '--target', 'x86_64-unknown-linux-gnu', '--artifact', 'dist/dsh.deb', '--install-deb',
  ]).installDeb, true);
  assert.throws(
    () => parseArguments(['--target', 'x86_64-pc-windows-msvc', '--artifact', 'dsh.exe']),
    /Linux x64 only/,
  );
  assert.throws(
    () => parseArguments(['--target', 'x86_64-unknown-linux-gnu', '--artifact', 'dsh.deb']),
    /expected a \.AppImage artifact/,
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
