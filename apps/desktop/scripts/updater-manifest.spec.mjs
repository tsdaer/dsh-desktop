import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { SUPPORTED_TARGETS } from './target-spec.mjs';
import { buildUpdaterManifest, verifyMinisignSignature } from './updater-manifest.mjs';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const publicKeyBytes = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
const keyId = Buffer.from('fixtr001');
function publicKeyText(rawKey) {
  return Buffer.from([
    'untrusted comment: minisign public key: fixture',
    Buffer.concat([Buffer.from('Ed'), keyId, rawKey]).toString('base64'),
  ].join('\n')).toString('base64');
}
const fixturePublicKey = publicKeyText(publicKeyBytes);

function signatureFor(path) {
  const artifact = readFileSync(path);
  const digest = createHash('blake2b512').update(artifact).digest();
  const fileSignature = sign(null, digest, privateKey);
  const trustedComment = `timestamp:1\tfile:${path.split(/[\\/]/).pop()}`;
  const globalSignature = sign(null, Buffer.concat([fileSignature, Buffer.from(trustedComment)]), privateKey);
  const content = [
    'untrusted comment: signature from fixture key',
    Buffer.concat([Buffer.from('ED'), keyId, fileSignature]).toString('base64'),
    `trusted comment: ${trustedComment}`,
    globalSignature.toString('base64'),
  ].join('\n');
  return Buffer.from(content).toString('base64');
}

test('fixture signature matches its generated public key', () => {
  const path = join(tmpdir(), `dsh-updater-signature-${process.pid}`);
  writeFileSync(path, 'artifact');
  try {
    verifyMinisignSignature(readFileSync(path), signatureFor(path), fixturePublicKey, path);
  } finally {
    rmSync(path, { force: true });
  }
});

test('rejects a changed artifact and a different updater public key', () => {
  const path = join(tmpdir(), `dsh-updater-signature-${process.pid}`);
  writeFileSync(path, 'artifact');
  const signature = signatureFor(path);
  const { publicKey: otherPublicKey } = generateKeyPairSync('ed25519');
  try {
    writeFileSync(path, 'changed');
    assert.throws(
      () => verifyMinisignSignature(readFileSync(path), signature, fixturePublicKey, path),
      /signature verification failed/,
    );
    writeFileSync(path, 'artifact');
    assert.throws(
      () => verifyMinisignSignature(
        readFileSync(path),
        signature,
        publicKeyText(otherPublicKey.export({ format: 'der', type: 'spki' }).subarray(-32)),
        path,
      ),
      /signature verification failed/,
    );
  } finally {
    rmSync(path, { force: true });
  }
});

function fixture() {
  const root = resolve(tmpdir(), `dsh-updater-${process.pid}-${Date.now()}`);
  mkdirSync(root, { recursive: true });
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function artifactDirectory(root, target, index = 0) {
  const relative = target.artifactDirectories[index].replaceAll('{rustTriple}', target.rustTriple);
  const path = join(root, relative);
  mkdirSync(path, { recursive: true });
  return path;
}

function populate(root, version = '0.3.4') {
  for (const target of Object.values(SUPPORTED_TARGETS)) {
    const primaryDir = artifactDirectory(root, target);
    const primary = `dsh-desktop_${version}${target.updaterArtifactSuffix}`;
    const primaryPath = join(primaryDir, primary);
    writeFileSync(primaryPath, 'artifact');
    writeFileSync(join(primaryDir, `${primary}.sig`), signatureFor(primaryPath));
    for (const suffix of target.updaterArtifactSuffixes) {
      if (suffix === target.updaterArtifactSuffix || suffix.endsWith('.sig')) continue;
      const path = join(artifactDirectory(root, target, target.artifactDirectories.length > 1 ? 1 : 0), `dsh-desktop_${version}${suffix}`);
      if (suffix === '.app') mkdirSync(path, { recursive: true });
      else writeFileSync(path, 'secondary');
    }
  }
}

test('generates one signed updater row for each supported target', async () => {
  const testFixture = fixture();
  try {
    populate(testFixture.root);
    const manifest = await buildUpdaterManifest({
      version: '0.3.4',
      tag: 'v0.3.4',
      desktopRoot: testFixture.root,
      publicKey: fixturePublicKey,
    });
    assert.deepEqual(Object.keys(manifest.platforms).sort(), ['darwin-aarch64', 'linux-x86_64', 'windows-x86_64']);
    assert.equal(
      manifest.platforms['linux-x86_64'].signature,
      readFileSync(join(artifactDirectory(testFixture.root, SUPPORTED_TARGETS['x86_64-unknown-linux-gnu']), 'dsh-desktop_0.3.4.AppImage.sig'), 'utf8').trim(),
    );
    assert.match(manifest.platforms['darwin-aarch64'].url, /dsh-desktop_0.3.4.app.tar.gz$/);
  } finally {
    testFixture.cleanup();
  }
});

test('uses only the target directories present in a staged release', async () => {
  const testFixture = fixture();
  try {
    for (const target of [
      SUPPORTED_TARGETS['x86_64-pc-windows-msvc'],
      SUPPORTED_TARGETS['x86_64-unknown-linux-gnu'],
    ]) {
      const directory = join(testFixture.root, target.productTarget);
      mkdirSync(directory, { recursive: true });
      const primary = `dsh-desktop_0.3.4${target.updaterArtifactSuffix}`;
      const primaryPath = join(directory, primary);
      writeFileSync(primaryPath, 'artifact');
      writeFileSync(join(directory, `${primary}.sig`), signatureFor(primaryPath));
    }
    const manifest = await buildUpdaterManifest({
      version: '0.3.4',
      tag: 'v0.3.4',
      desktopRoot: testFixture.root,
      publicKey: fixturePublicKey,
      targets: [
        SUPPORTED_TARGETS['x86_64-pc-windows-msvc'],
        SUPPORTED_TARGETS['x86_64-unknown-linux-gnu'],
      ],
    });
    assert.deepEqual(Object.keys(manifest.platforms).sort(), ['linux-x86_64', 'windows-x86_64']);
    assert.match(manifest.platforms['linux-x86_64'].url, /\.AppImage$/);
  } finally {
    testFixture.cleanup();
  }
});

test('rejects missing signatures, duplicate targets, wrong versions, and unexpected files', async () => {
  const cases = [
    {
      message: /missing updater signature/,
      mutate(root) {
        const target = SUPPORTED_TARGETS['x86_64-pc-windows-msvc'];
        const directory = artifactDirectory(root, target);
        rmSync(join(directory, `dsh-desktop_0.3.4${target.updaterArtifactSuffix}.sig`));
      },
    },
    {
      message: /found 2/,
      mutate(root) {
        const target = SUPPORTED_TARGETS['x86_64-unknown-linux-gnu'];
        const directory = artifactDirectory(root, target);
        writeFileSync(join(directory, 'dsh-desktop_0.3.4-second.AppImage'), 'artifact');
        writeFileSync(join(directory, 'dsh-desktop_0.3.4-second.AppImage.sig'), 'signature');
      },
    },
    {
      message: /does not contain version 0.3.4/,
      mutate(root) {
        const target = SUPPORTED_TARGETS['aarch64-apple-darwin'];
        const directory = artifactDirectory(root, target);
        rmSync(join(directory, 'dsh-desktop_0.3.4.app.tar.gz'));
        rmSync(join(directory, 'dsh-desktop_0.3.4.app.tar.gz.sig'));
        writeFileSync(join(directory, 'dsh-desktop_0.3.3.app.tar.gz'), 'artifact');
        writeFileSync(join(directory, 'dsh-desktop_0.3.3.app.tar.gz.sig'), 'signature');
      },
    },
    {
      message: /unexpected windows-x64 artifact/,
      mutate(root) {
        artifactDirectory(root, SUPPORTED_TARGETS['x86_64-pc-windows-msvc']);
        writeFileSync(join(artifactDirectory(root, SUPPORTED_TARGETS['x86_64-pc-windows-msvc']), 'notes.txt'), 'unexpected');
      },
    },
  ];
  for (const scenario of cases) {
    const testFixture = fixture();
    try {
      populate(testFixture.root);
      scenario.mutate(testFixture.root);
      await assert.rejects(
        buildUpdaterManifest({
          version: '0.3.4',
          tag: 'v0.3.4',
          desktopRoot: testFixture.root,
          publicKey: fixturePublicKey,
        }),
        scenario.message,
      );
    } finally {
      testFixture.cleanup();
    }
  }
});
