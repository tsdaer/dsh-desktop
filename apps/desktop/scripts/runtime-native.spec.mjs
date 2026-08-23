import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

import { resolveTarget } from './target-spec.mjs';
import { pruneNativeRuntime, validateNativeRuntime } from './runtime-native.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-native-test-'));
  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
    file(relative) {
      const path = join(root, relative);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, 'native');
      return path;
    },
  };
}

test('prunes every prebuild directory to the selected target and validates node-pty and koffi', () => {
  const testFixture = fixture();
  try {
    testFixture.file('node_modules/node-pty/prebuilds/linux-x64/pty.node');
    testFixture.file('node_modules/node-pty/prebuilds/win32-x64/pty.node');
    testFixture.file('node_modules/koffi/prebuilds/linux-x64/koffi.node');
    testFixture.file('node_modules/koffi/prebuilds/darwin-arm64/koffi.node');
    const target = resolveTarget('x86_64-unknown-linux-gnu');

    pruneNativeRuntime(testFixture.root, target);
    validateNativeRuntime(testFixture.root, target);

    assert.deepEqual(
      readdirSync(join(testFixture.root, 'node_modules/node-pty/prebuilds')),
      ['linux-x64'],
    );
    assert.equal(
      readFileSync(join(testFixture.root, 'node_modules/koffi/prebuilds/linux-x64/koffi.node'), 'utf8'),
      'native',
    );
  } finally {
    testFixture.cleanup();
  }
});

test('rejects a prebuild directory without the selected target binary', () => {
  const testFixture = fixture();
  try {
    testFixture.file('node_modules/node-pty/prebuilds/win32-x64/pty.node');
    assert.throws(
      () => pruneNativeRuntime(testFixture.root, resolveTarget('x86_64-unknown-linux-gnu')),
      /native binary missing for linux-x64/,
    );
  } finally {
    testFixture.cleanup();
  }
});

test('accepts a target source build when no target prebuild is available', () => {
  const testFixture = fixture();
  try {
    testFixture.file('node_modules/node-pty/prebuilds/win32-x64/pty.node');
    testFixture.file('node_modules/node-pty/build/Release/pty.node');
    const target = resolveTarget('x86_64-unknown-linux-gnu');

    pruneNativeRuntime(testFixture.root, target);
    validateNativeRuntime(testFixture.root, target);

    assert.deepEqual(
      readdirSync(join(testFixture.root, 'node_modules/node-pty/prebuilds')),
      [],
    );
  } finally {
    testFixture.cleanup();
  }
});

test('accepts the target-specific Koffi optional package', () => {
  const testFixture = fixture();
  try {
    testFixture.file('node_modules/koffi/package.json');
    testFixture.file('node_modules/@koromix/koffi-linux-x64/linux_x64/koffi.node');
    validateNativeRuntime(testFixture.root, resolveTarget('x86_64-unknown-linux-gnu'));
  } finally {
    testFixture.cleanup();
  }
});

test('rejects Koffi when only another target optional package is present', () => {
  const testFixture = fixture();
  try {
    testFixture.file('node_modules/koffi/package.json');
    testFixture.file('node_modules/@koromix/koffi-win32-x64/win32_x64/koffi.node');
    assert.throws(
      () => validateNativeRuntime(testFixture.root, resolveTarget('x86_64-unknown-linux-gnu')),
      /native package has no loadable binary/,
    );
  } finally {
    testFixture.cleanup();
  }
});

test('rejects foreign platform native files after pruning', () => {
  const testFixture = fixture();
  try {
    testFixture.file('node_modules/node-pty/prebuilds/linux-x64/pty.node');
    testFixture.file('node_modules/koffi/build/koffi.dll');
    assert.throws(
      () => validateNativeRuntime(testFixture.root, resolveTarget('x86_64-unknown-linux-gnu')),
      /foreign native file for linux runtime/,
    );
  } finally {
    testFixture.cleanup();
  }
});
