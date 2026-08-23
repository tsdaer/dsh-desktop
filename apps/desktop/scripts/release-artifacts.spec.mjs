import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { collectReleaseArtifacts, stageReleaseArtifacts, verifyStagedRelease } from './release-artifacts.mjs';
import { resolveTarget } from './target-spec.mjs';

function fixture() {
  const root = resolve(tmpdir(), `dsh-release-${process.pid}-${Date.now()}`);
  mkdirSync(root, { recursive: true });
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function populate(root, target, version = '0.3.4') {
  for (const [index, relative] of target.artifactDirectories.entries()) {
    const directory = join(root, relative.replaceAll('{rustTriple}', target.rustTriple));
    mkdirSync(directory, { recursive: true });
    const suffixes = target.artifactDirectories.length === 1
      ? target.updaterArtifactSuffixes
      : target.updaterArtifactSuffixes.filter((suffix) => index === 0
        ? suffix.startsWith('.AppImage') || suffix.startsWith('.app')
        : suffix.startsWith('.deb') || suffix.startsWith('.dmg'));
    for (const suffix of suffixes) {
      const name = target.productTarget === 'macos-arm64' && suffix === '.app'
        ? 'dsh-desktop.app'
        : `dsh-desktop_${version}${suffix}`;
      const path = join(directory, name);
      if (suffix === '.app') mkdirSync(path, { recursive: true });
      else writeFileSync(path, suffix.endsWith('.sig') ? 'signature' : 'artifact');
    }
  }
}

test('stages the complete target inventory and verifies its stable layout', () => {
  const testFixture = fixture();
  try {
    const target = resolveTarget('x86_64-unknown-linux-gnu');
    populate(testFixture.root, target);
    mkdirSync(join(
      testFixture.root,
      'src-tauri/target/x86_64-unknown-linux-gnu/release/bundle/appimage/dsh-desktop.AppDir',
    ), { recursive: true });
    mkdirSync(join(
      testFixture.root,
      'src-tauri/target/x86_64-unknown-linux-gnu/release/bundle/deb/dsh-desktop_0.3.4_amd64',
    ), { recursive: true });
    const output = resolve(testFixture.root, 'out');
    const targetRoot = stageReleaseArtifacts(target, testFixture.root, output);
    assert.equal(targetRoot, join(output, 'linux-x64'));
    const inventory = verifyStagedRelease({ root: output, version: '0.3.4', targets: [target] });
    assert.equal(inventory.length, target.updaterArtifactSuffixes.length);
  } finally {
    testFixture.cleanup();
  }
});

test('accepts Tauri’s unversioned macOS app bundle alongside versioned release files', () => {
  const testFixture = fixture();
  try {
    const target = resolveTarget('aarch64-apple-darwin');
    populate(testFixture.root, target);
    const output = resolve(testFixture.root, 'out');
    stageReleaseArtifacts(target, testFixture.root, output);
    const inventory = verifyStagedRelease({ root: output, version: '0.3.4', targets: [target] });
    assert.equal(inventory.length, target.updaterArtifactSuffixes.length);
    assert.equal(inventory.find((entry) => entry.name === 'dsh-desktop.app')?.target, 'macos-arm64');
  } finally {
    testFixture.cleanup();
  }
});

test('rejects missing, unexpected, duplicate, and wrong-version staged artifacts', () => {
  const testFixture = fixture();
  try {
    const target = resolveTarget('x86_64-pc-windows-msvc');
    populate(testFixture.root, target);
    const bundle = resolve(testFixture.root, 'src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis');
    rmSync(join(bundle, 'dsh-desktop_0.3.4.exe.sig'));
    assert.throws(() => collectReleaseArtifacts(target, testFixture.root), /missing .*\.exe\.sig/);
    writeFileSync(join(bundle, 'dsh-desktop_0.3.4.exe.sig'), 'signature');
    writeFileSync(join(bundle, 'notes.txt'), 'unexpected');
    assert.throws(() => collectReleaseArtifacts(target, testFixture.root), /unexpected .*notes\.txt/);
    rmSync(join(bundle, 'notes.txt'));
    const output = resolve(testFixture.root, 'out');
    stageReleaseArtifacts(target, testFixture.root, output);
    rmSync(join(output, 'windows-x64', 'dsh-desktop_0.3.4.exe'));
    writeFileSync(join(output, 'windows-x64', 'dsh-desktop_0.3.3.exe'), 'artifact');
    assert.throws(() => verifyStagedRelease({ root: output, version: '0.3.4', targets: [target] }), /does not contain version/);

    const linux = resolveTarget('x86_64-unknown-linux-gnu');
    populate(testFixture.root, linux);
    const linuxSecondBundle = resolve(testFixture.root, 'src-tauri/target/x86_64-unknown-linux-gnu/release/bundle/deb');
    writeFileSync(join(linuxSecondBundle, 'dsh-desktop_0.3.4.AppImage'), 'duplicate');
    assert.throws(() => collectReleaseArtifacts(linux, testFixture.root), /duplicate .*AppImage/);
  } finally {
    testFixture.cleanup();
  }
});
