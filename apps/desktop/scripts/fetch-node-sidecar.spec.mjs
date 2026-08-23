import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { Readable } from 'node:stream';
import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  checksumForArchive,
  downloadFile,
  extractArchive,
  fetchNodeSidecar,
  installFetchedSidecar,
  verifySha256,
} from './fetch-node-sidecar.mjs';
import { resolveTarget } from './target-spec.mjs';

const target = resolveTarget('x86_64-unknown-linux-gnu');
const version = '22.23.1';

function temporaryDirectory() {
  return mkdtempSync(join(tmpdir(), 'dsh-sidecar-test-'));
}

function fixtureDownload(archiveBytes, checksumText) {
  return async (url, destinationPath) => {
    writeFileSync(destinationPath, url.endsWith('SHASUMS256.txt') ? checksumText : archiveBytes);
  };
}

function fixtureExtract(sourceText) {
  return (archivePath, extractDir, selectedTarget) => {
    assert.equal(readFileSync(archivePath, 'utf8'), 'fixture archive');
    mkdirSync(join(extractDir, `node-v${version}-linux-x64`, 'bin'), { recursive: true });
    if (sourceText !== undefined) {
      const member = selectedTarget.sidecarSourceMember.replace('{version}', version);
      writeFileSync(join(extractDir, member), sourceText);
    }
  };
}

function checksum(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function requestResponse(statusCode, body, headers = {}) {
  return (url, callback) => {
    const request = { on() { return request; } };
    queueMicrotask(() => callback({
      headers,
      statusCode,
      resume() {},
      pipe(output) {
        Readable.from([body]).pipe(output);
      },
      on(event, handler) {
        if (event === 'error') this.errorHandler = handler;
        return this;
      },
    }));
    return request;
  };
}

test('parses and verifies the exact Node archive checksum', () => {
  const bytes = Buffer.from('fixture archive');
  const digest = checksum(bytes);
  assert.equal(checksumForArchive(`${digest}  node-v22.23.1-linux-x64.tar.xz\n`, 'node-v22.23.1-linux-x64.tar.xz'), digest);
  const root = temporaryDirectory();
  const file = join(root, 'archive');
  writeFileSync(file, bytes);
  verifySha256(file, digest.toUpperCase());
  assert.throws(() => checksumForArchive(`${digest}  other.tar.xz`, 'node-v22.23.1-linux-x64.tar.xz'), /no entry/);
  assert.throws(() => verifySha256(file, '0'.repeat(64)), /SHA-256 mismatch/);
  rmSync(root, { recursive: true, force: true });
});

test('follows redirects and rejects HTTP failures before creating a cache entry', async () => {
  const root = temporaryDirectory();
  const redirected = join(root, 'redirected');
  let calls = 0;
  const redirectRequest = (url, callback) => {
    calls += 1;
    return requestResponse(calls === 1 ? 302 : 200, calls === 1 ? '' : 'archive', calls === 1 ? { location: 'https://example.test/final' } : {})(url, callback);
  };
  await downloadFile('https://example.test/archive', redirected, { request: redirectRequest, proxy: null });
  assert.equal(readFileSync(redirected, 'utf8'), 'archive');
  const failed = join(root, 'failed');
  await assert.rejects(downloadFile('https://example.test/failure', failed, {
    request: requestResponse(404, 'missing'),
    proxy: null,
  }), /HTTP 404/);
  assert.equal(existsSync(failed), false);
  rmSync(root, { recursive: true, force: true });
});

test('extracts a Windows zip through tar with argv-bound paths', () => {
  const root = temporaryDirectory();
  try {
    const archivePath = join(root, 'node archive.zip');
    const extractDir = join(root, 'extracted files');
    const calls = [];
    extractArchive(
      archivePath,
      extractDir,
      { nodeArchiveKind: 'zip' },
      'win32',
      (command, args, options) => calls.push({ command, args, options }),
    );
    assert.deepEqual(calls, [{
      command: 'tar',
      args: ['-xf', archivePath, '-C', extractDir],
      options: { stdio: 'inherit' },
    }]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('verifies, installs, and records an exact POSIX sidecar name and mode', async () => {
  const root = temporaryDirectory();
  const destination = join(root, target.sidecarBasename);
  const metadataPath = `${destination}.meta.json`;
  const archiveBytes = Buffer.from('fixture archive');
  const digest = checksum(archiveBytes);
  const executableModes = [];
  const result = await fetchNodeSidecar({
    target,
    version,
    destination,
    metadataPath,
    download: fixtureDownload(archiveBytes, `${digest}  node-v22.23.1-linux-x64.tar.xz\n`),
    extract: fixtureExtract('node binary'),
    readVersion: () => 'v22.23.1',
    setExecutable: (filePath, mode) => {
      executableModes.push({ filePath, mode });
      chmodSync(filePath, mode);
    },
    hostPlatform: 'linux',
  });
  assert.equal(result.cached, false);
  assert.equal(result.destination.endsWith('node-x86_64-unknown-linux-gnu'), true);
  assert.deepEqual(executableModes.map(({ mode }) => mode), [0o755, 0o755, 0o755]);
  if (process.platform !== 'win32') assert.equal(statSync(destination).mode & 0o111, 0o111);
  assert.deepEqual(JSON.parse(readFileSync(metadataPath, 'utf8')), {
    archiveName: 'node-v22.23.1-linux-x64.tar.xz',
    sha256: digest,
    version,
    rustTriple: target.rustTriple,
  });
  rmSync(root, { recursive: true, force: true });
});

test('restores the previous sidecar when the final replacement fails', () => {
  const root = temporaryDirectory();
  const destination = join(root, target.sidecarBasename);
  const metadataPath = `${destination}.meta.json`;
  const staged = join(root, 'staged-sidecar');
  writeFileSync(destination, 'old binary');
  writeFileSync(metadataPath, 'old metadata\n');
  writeFileSync(staged, 'new binary');
  let modeCalls = 0;

  assert.throws(() => installFetchedSidecar({
    stagedDestination: staged,
    destination,
    metadataPath,
    metadataText: 'new metadata\n',
    setExecutable: () => {
      modeCalls += 1;
      if (modeCalls === 2) throw new Error('mode update failed');
    },
    hostPlatform: 'linux',
  }), /mode update failed/);
  assert.equal(readFileSync(destination, 'utf8'), 'old binary');
  assert.equal(readFileSync(metadataPath, 'utf8'), 'old metadata\n');
  assert.deepEqual(
    readdirSync(root).filter((name) => name.includes('.tmp-') || name.includes('.bak-')),
    [],
  );
  rmSync(root, { recursive: true, force: true });
});

test('invalidates stale metadata and rejects a missing archive member or corrupt archive', async () => {
  const root = temporaryDirectory();
  const destination = join(root, target.sidecarBasename);
  const metadataPath = `${destination}.meta.json`;
  writeFileSync(destination, 'old binary');
  writeFileSync(metadataPath, JSON.stringify({ version: '21.0.0', rustTriple: target.rustTriple, sha256: '0'.repeat(64) }));
  const archiveBytes = Buffer.from('fixture archive');
  const digest = checksum(archiveBytes);
  const options = {
    target,
    version,
    destination,
    metadataPath,
    download: fixtureDownload(archiveBytes, `${digest}  node-v22.23.1-linux-x64.tar.xz\n`),
    readVersion: () => 'v22.23.1',
  };
  await assert.rejects(fetchNodeSidecar({ ...options, extract: fixtureExtract() }), /not found/);
  assert.equal(readFileSync(destination, 'utf8'), 'old binary');
  await assert.rejects(fetchNodeSidecar({
    ...options,
    download: fixtureDownload(Buffer.from('corrupt archive'), `${digest}  node-v22.23.1-linux-x64.tar.xz\n`),
    extract: fixtureExtract('node binary'),
  }), /SHA-256 mismatch/);
  assert.equal(readFileSync(destination, 'utf8'), 'old binary');
  rmSync(root, { recursive: true, force: true });
});

test('keeps the previous cache when the injected installation step fails', async () => {
  const root = temporaryDirectory();
  const destination = join(root, target.sidecarBasename);
  const metadataPath = `${destination}.meta.json`;
  writeFileSync(destination, 'old binary');
  writeFileSync(metadataPath, 'old metadata\n');
  const archiveBytes = Buffer.from('fixture archive');
  const digest = checksum(archiveBytes);
  await assert.rejects(fetchNodeSidecar({
    target,
    version,
    destination,
    metadataPath,
    download: fixtureDownload(archiveBytes, `${digest}  node-v22.23.1-linux-x64.tar.xz\n`),
    extract: fixtureExtract('node binary'),
    readVersion: () => 'v22.23.1',
    install: () => { throw new Error('installation failed'); },
    hostPlatform: 'linux',
  }), /installation failed/);
  assert.equal(readFileSync(destination, 'utf8'), 'old binary');
  assert.equal(readFileSync(metadataPath, 'utf8'), 'old metadata\n');
  rmSync(root, { recursive: true, force: true });
});

test('removes the temporary extraction root after success and failure', async () => {
  const root = temporaryDirectory();
  const temporaryRoot = join(root, 'work');
  mkdirSync(temporaryRoot);
  const archiveBytes = Buffer.from('fixture archive');
  const digest = checksum(archiveBytes);
  const common = {
    target,
    version,
    destination: join(root, 'sidecar'),
    metadataPath: join(root, 'sidecar.meta.json'),
    download: fixtureDownload(archiveBytes, `${digest}  node-v22.23.1-linux-x64.tar.xz\n`),
    createTemporaryRoot: () => temporaryRoot,
    readVersion: () => 'v22.23.1',
  };
  await fetchNodeSidecar({ ...common, extract: fixtureExtract('node binary') });
  assert.equal(existsSync(temporaryRoot), false);
  rmSync(root, { recursive: true, force: true });
});
