import assert from 'node:assert/strict';
import test from 'node:test';

import { packagedSmokeArguments, parseArguments, runPackagedSmoke, runUpdateSmoke } from './update-smoke.mjs';

test('requires a fixed loopback port and validates the next version', () => {
  const options = parseArguments([
    '--target', 'x86_64-unknown-linux-gnu',
    '--artifact', 'dist/dsh-desktop_0.3.4_amd64.AppImage',
    '--next-version', '0.3.5',
    '--artifact-root', 'dist/next',
    '--port', '4317',
    '--terminal-smoke',
  ]);
  assert.equal(options.target.productTarget, 'linux-x64');
  assert.equal(options.port, 4317);
  assert.equal(options.terminalSmoke, true);
  assert.throws(() => parseArguments([
    '--target', 'x86_64-unknown-linux-gnu', '--artifact', 'app.AppImage', '--next-version', '0.3.5', '--port', '0',
  ]), /--port must be an integer from 1 to 65535/);
  assert.throws(() => parseArguments([
    '--target', 'x86_64-unknown-linux-gnu', '--artifact', 'app.AppImage', '--next-version', '0.3', '--port', '4317',
  ]), /invalid next update version/);
});

test('selects the installer mode from the target artifact without shell interpolation', () => {
  assert.deepEqual(packagedSmokeArguments({
    target: { rustTriple: 'x86_64-pc-windows-msvc', productTarget: 'windows-x64' },
    artifact: 'dsh-desktop.exe',
    nextVersion: '0.3.5',
  }), [
    '--target', 'x86_64-pc-windows-msvc', '--artifact', 'dsh-desktop.exe', '--install-nsis',
    '--update-smoke', '--expected-version', '0.3.5',
  ]);
  assert.deepEqual(packagedSmokeArguments({
    target: { rustTriple: 'aarch64-apple-darwin', productTarget: 'macos-arm64' },
    artifact: 'dsh-desktop.dmg',
    nextVersion: '0.3.5',
    terminalSmoke: true,
  }), [
    '--target', 'aarch64-apple-darwin', '--artifact', 'dsh-desktop.dmg', '--install-dmg',
    '--update-smoke', '--expected-version', '0.3.5', '--terminal-smoke',
  ]);
  assert.throws(() => parseArguments([
    '--target', 'x86_64-pc-windows-msvc', '--artifact', 'dsh-desktop.AppImage', '--next-version', '0.3.5', '--port', '4317',
  ]), /does not match windows-x64/);
});

test('closes the fixture server when the packaged smoke fails', async () => {
  let closed = false;
  await assert.rejects(runUpdateSmoke({
    target: { rustTriple: 'x86_64-unknown-linux-gnu', productTarget: 'linux-x64' },
    artifact: 'version-n.AppImage',
    nextVersion: '0.3.5',
    artifactRoot: 'dist',
    manifestPath: 'dist/latest.json',
    host: '127.0.0.1',
    port: 4317,
  }, {
    load: async () => ({ target: {}, version: '0.3.5', artifactPath: 'next.AppImage', signaturePath: 'next.AppImage.sig', manifest: {} }),
    serve: async () => ({
      url: 'http://127.0.0.1:4317/latest.json',
      server: { close(callback) { closed = true; callback(); } },
    }),
    run: async () => { throw new Error('smoke failed'); },
  }), /smoke failed/);
  assert.equal(closed, true);
});

test('reports the packaged smoke exit status and captured output', async () => {
  const output = await runPackagedSmoke({
    target: { rustTriple: 'x86_64-unknown-linux-gnu', productTarget: 'linux-x64' },
    artifact: 'version-n.AppImage',
    nextVersion: '0.3.5',
  }, {
    spawnProcess: (_command, _args) => {
      return {
        stdout: { on(_event, handler) { handler('ready\n'); } },
        stderr: { on() {} },
        once(event, handler) { if (event === 'close') handler(0, null); },
      };
    },
  });
  assert.equal(output, 'ready\n');
});
