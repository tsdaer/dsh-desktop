import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SUPPORTED_TARGETS,
  assertSafeArchiveMember,
  extractionPath,
  nodeDistributionFiles,
  resolveTarget,
} from './target-spec.mjs';

const expected = {
  'x86_64-pc-windows-msvc': {
    productTarget: 'windows-x64',
    nodePlatform: 'win',
    nodeArchitecture: 'x64',
    nodeArchiveKind: 'zip',
    nodeArchivePlatform: 'win-x64',
    sidecarSourceMember: 'node-v{version}-win-x64/node.exe',
    sidecarBasename: 'node-x86_64-pc-windows-msvc.exe',
    nativePlatformKey: 'win32-x64',
    bundleKinds: ['nsis'],
    artifactDirectories: ['src-tauri/target/release/bundle/nsis'],
    updaterArtifactSuffixes: ['.exe', '.exe.sig'],
    runtimeRelativeDir: '.runtime/x86_64-pc-windows-msvc/deploy',
    sizeBudgetMiB: 200,
  },
  'x86_64-unknown-linux-gnu': {
    productTarget: 'linux-x64',
    nodePlatform: 'linux',
    nodeArchitecture: 'x64',
    nodeArchiveKind: 'tar.xz',
    nodeArchivePlatform: 'linux-x64',
    sidecarSourceMember: 'node-v{version}-linux-x64/bin/node',
    sidecarBasename: 'node-x86_64-unknown-linux-gnu',
    nativePlatformKey: 'linux-x64',
    bundleKinds: ['appimage', 'deb'],
    artifactDirectories: [
      'src-tauri/target/release/bundle/appimage',
      'src-tauri/target/release/bundle/deb',
    ],
    updaterArtifactSuffixes: ['.AppImage', '.AppImage.sig', '.deb', '.deb.sig'],
    runtimeRelativeDir: '.runtime/x86_64-unknown-linux-gnu/deploy',
    sizeBudgetMiB: 220,
  },
  'aarch64-apple-darwin': {
    productTarget: 'macos-arm64',
    nodePlatform: 'darwin',
    nodeArchitecture: 'arm64',
    nodeArchiveKind: 'tar.gz',
    nodeArchivePlatform: 'darwin-arm64',
    sidecarSourceMember: 'node-v{version}-darwin-arm64/bin/node',
    sidecarBasename: 'node-aarch64-apple-darwin',
    nativePlatformKey: 'darwin-arm64',
    bundleKinds: ['app', 'dmg'],
    artifactDirectories: [
      'src-tauri/target/release/bundle/macos',
      'src-tauri/target/release/bundle/dmg',
    ],
    updaterArtifactSuffixes: ['.app', '.app.tar.gz', '.app.tar.gz.sig', '.dmg', '.dmg.sig'],
    runtimeRelativeDir: '.runtime/aarch64-apple-darwin/deploy',
    sizeBudgetMiB: 220,
  },
};

test('pins every supported target row', () => {
  assert.deepEqual(Object.keys(SUPPORTED_TARGETS), Object.keys(expected));
  for (const [triple, fields] of Object.entries(expected)) {
    const target = resolveTarget(triple);
    for (const [field, value] of Object.entries(fields)) assert.deepEqual(target[field], value);
    assert.equal(target.rustTriple, triple);
    assert.equal(Object.isFrozen(target), true);
    assert.equal(Object.isFrozen(target.bundleKinds), true);
  }
});

test('rejects absent, malformed, and unsupported target triples', () => {
  assert.throws(() => resolveTarget(''), /invalid desktop target triple/);
  assert.throws(() => resolveTarget('x86_64-pc-windows'), /unsupported desktop target triple/);
  assert.throws(() => resolveTarget('x86_64-unknown-linux-musl'), /unsupported desktop target triple/);
  assert.throws(() => resolveTarget(undefined, { detectHost: () => 'aarch64-unknown-linux-gnu' }), /unsupported desktop target triple/);
});

test('renders versioned Node archive names and exact sidecar members', () => {
  assert.deepEqual(nodeDistributionFiles(resolveTarget('x86_64-pc-windows-msvc'), '22.23.1'), {
    archiveName: 'node-v22.23.1-win-x64.zip',
    sourceMember: 'node-v22.23.1-win-x64/node.exe',
  });
  assert.deepEqual(nodeDistributionFiles(resolveTarget('x86_64-unknown-linux-gnu'), '22.23.1'), {
    archiveName: 'node-v22.23.1-linux-x64.tar.xz',
    sourceMember: 'node-v22.23.1-linux-x64/bin/node',
  });
  assert.deepEqual(nodeDistributionFiles(resolveTarget('aarch64-apple-darwin'), '22.23.1'), {
    archiveName: 'node-v22.23.1-darwin-arm64.tar.gz',
    sourceMember: 'node-v22.23.1-darwin-arm64/bin/node',
  });
  assert.throws(() => nodeDistributionFiles(resolveTarget('x86_64-pc-windows-msvc'), '../node'), /invalid DSH_NODE_VERSION/);
});

test('rejects archive members that could escape extraction', () => {
  for (const member of ['../node', 'node/../../escape', '/absolute/node', 'C:/node', 'node\\escape', '']) {
    assert.throws(() => assertSafeArchiveMember(member), /unsafe archive member/);
  }
  const resolved = extractionPath('C:/tmp/dsh-extract', 'node-v22.23.1-win-x64/node.exe');
  assert.match(resolved, /node-v22\.23\.1-win-x64[\\/]node\.exe$/);
});
