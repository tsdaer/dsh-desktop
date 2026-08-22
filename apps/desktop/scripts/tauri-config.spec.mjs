import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';

import { resolveTarget } from './target-spec.mjs';
import { effectiveTauriConfig, tauriBuildArgs } from './tauri-config.mjs';

const desktopRoot = resolve(import.meta.dirname, '..');

test('effective Tauri config selects the reviewed layer for every target', () => {
  for (const triple of [
    'x86_64-pc-windows-msvc',
    'x86_64-unknown-linux-gnu',
    'aarch64-apple-darwin',
  ]) {
    const target = resolveTarget(triple);
    const config = effectiveTauriConfig(target, desktopRoot);
    assert.deepEqual(config.bundle.targets, target.bundleKinds);
    assert.deepEqual(config.bundle.externalBin, ['binaries/node']);
    assert.deepEqual(Object.values(config.bundle.resources), ['runtime']);
    if (target.rustTriple === 'x86_64-pc-windows-msvc') {
      assert.equal(config.bundle.windows.webviewInstallMode.type, 'embedBootstrapper');
      assert.equal(config.bundle.windows.nsis.installerHooks, 'installer-hooks.nsh');
    } else if (target.rustTriple === 'x86_64-unknown-linux-gnu') {
      assert.deepEqual(config.bundle.linux.deb.depends, ['libwebkit2gtk-4.1-0', 'libgtk-3-0']);
    } else {
      assert.equal(config.bundle.macOS.minimumSystemVersion, '13.0');
      assert.equal(config.bundle.macOS.hardenedRuntime, true);
    }
  }
});

test('Tauri build arguments carry the same explicit target and config layer', () => {
  const target = resolveTarget('x86_64-unknown-linux-gnu');
  assert.deepEqual(tauriBuildArgs(target, desktopRoot), [
    '--ci',
    '--target',
    'x86_64-unknown-linux-gnu',
    '--config',
    resolve(desktopRoot, 'src-tauri/tauri.linux-x64.conf.json'),
  ]);
});
