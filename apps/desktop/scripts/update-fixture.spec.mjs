import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadFixture, parseArguments, serveUpdateFixture } from './update-fixture.mjs';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const keyId = Buffer.from('fixtr002');
const fixturePublicKey = Buffer.from([
  'untrusted comment: minisign public key: fixture',
  Buffer.concat([Buffer.from('Ed'), keyId, publicKey.export({ format: 'der', type: 'spki' }).subarray(-32)]).toString('base64'),
].join('\n')).toString('base64');

function signatureFor(bytes, name) {
  const digest = createHash('blake2b512').update(bytes).digest();
  const fileSignature = sign(null, digest, privateKey);
  const trustedComment = `timestamp:1\tfile:${name}`;
  const globalSignature = sign(null, Buffer.concat([fileSignature, Buffer.from(trustedComment)]), privateKey);
  return Buffer.from([
    'untrusted comment: signature from fixture key',
    Buffer.concat([Buffer.from('ED'), keyId, fileSignature]).toString('base64'),
    `trusted comment: ${trustedComment}`,
    globalSignature.toString('base64'),
  ].join('\n')).toString('base64');
}

test('requires an explicit supported target and validates fixture options', () => {
  const options = parseArguments([
    '--target', 'x86_64-unknown-linux-gnu', '--version', '0.3.5', '--artifact-root', 'dist', '--port', '4317',
  ]);
  assert.equal(options.target.productTarget, 'linux-x64');
  assert.equal(options.version, '0.3.5');
  assert.equal(options.port, 4317);
  assert.throws(() => parseArguments(['--version', '0.3.5']), /--target requires/);
  assert.throws(() => parseArguments([
    '--target', 'x86_64-unknown-linux-gnu', '--version', 'next',
  ]), /valid desktop version/);
  assert.throws(() => parseArguments([
    '--target', 'x86_64-unknown-linux-gnu', '--version', '0.3.5', '--host', '0.0.0.0',
  ]), /loopback/);
});

test('serves only the selected target artifact and rewrites its URL to loopback', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-update-fixture-'));
  try {
    const targetRoot = join(root, 'linux-x64');
    await mkdir(targetRoot, { recursive: true });
    const artifact = join(targetRoot, 'dsh-desktop_0.3.5.AppImage');
    const artifactBytes = Buffer.from('artifact');
    const signature = signatureFor(artifactBytes, 'dsh-desktop_0.3.5.AppImage');
    await writeFile(artifact, artifactBytes);
    await writeFile(`${artifact}.sig`, signature);
    await writeFile(join(root, 'latest.json'), JSON.stringify({
      version: '0.3.5',
      platforms: { 'linux-x86_64': { signature, url: 'https://example.invalid/dsh-desktop_0.3.5.AppImage' } },
    }));
    const loaded = await loadFixture({
      target: { productTarget: 'linux-x64', updaterPlatform: 'linux-x86_64' },
      version: '0.3.5',
      artifactRoot: root,
      manifestPath: join(root, 'latest.json'),
      publicKey: fixturePublicKey,
    });
    const fixture = {
      ...loaded,
    };
    const served = await serveUpdateFixture({ fixture });
    try {
      const manifestResponse = await fetch(served.url);
      assert.equal(manifestResponse.status, 200);
      const manifest = await manifestResponse.json();
      assert.match(manifest.platforms['linux-x86_64'].url, /^http:\/\/127\.0\.0\.1:\d+\/artifacts\//);
      assert.equal((await fetch(manifest.platforms['linux-x86_64'].url)).status, 200);
      assert.equal((await fetch(`${new URL(served.url).origin}/artifacts/../update-fixture.mjs`)).status, 404);
      assert.equal((await fetch(`${new URL(served.url).origin}/wrong`)).status, 404);
    } finally {
      await new Promise((resolveClose) => served.server.close(resolveClose));
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
