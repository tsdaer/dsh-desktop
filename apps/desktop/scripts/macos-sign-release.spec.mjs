import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { nestedCodePaths, readSigningInputs } from './macos-sign-release.mjs';

test('requires every macOS signing input without exposing values in the error', () => {
  assert.throws(
    () => readSigningInputs({ DSH_MACOS_APP: '/tmp/dsh.app' }),
    /DSH_MACOS_DMG is required/,
  );
  assert.throws(
    () => readSigningInputs({ DSH_MACOS_APP: '/tmp/dsh.app', DSH_MACOS_DMG: '/tmp/dsh.dmg', MACOS_SIGNING_IDENTITY: 'Developer ID Application: test' }),
    /DSH_MACOS_ARCHIVE is required/,
  );
});

test('enumerates nested native and executable files before the app bundle', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-macos-sign-test-'));
  const app = join(root, 'dsh-desktop.app');
  mkdirSync(join(app, 'Contents', 'Resources'), { recursive: true });
  writeFileSync(join(app, 'Contents', 'Resources', 'helper.dylib'), 'helper');
  writeFileSync(join(app, 'Contents', 'Resources', 'native.node'), 'native');
  writeFileSync(join(app, 'Contents', 'Info.plist'), '<plist/>');
  const paths = nestedCodePaths(app);
  assert.deepEqual(paths.map((value) => basename(value)).sort(), ['helper.dylib', 'native.node']);
  rmSync(root, { recursive: true, force: true });
});
