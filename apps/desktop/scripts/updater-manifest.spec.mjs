import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { SUPPORTED_TARGETS } from './target-spec.mjs';
import { buildUpdaterManifest } from './updater-manifest.mjs';

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
    writeFileSync(join(primaryDir, primary), 'artifact');
    writeFileSync(join(primaryDir, `${primary}.sig`), 'signature');
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
    const manifest = await buildUpdaterManifest({ version: '0.3.4', tag: 'v0.3.4', desktopRoot: testFixture.root });
    assert.deepEqual(Object.keys(manifest.platforms).sort(), ['darwin-aarch64', 'linux-x86_64', 'windows-x86_64']);
    assert.equal(manifest.platforms['linux-x86_64'].signature, 'signature');
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
      writeFileSync(join(directory, primary), 'artifact');
      writeFileSync(join(directory, `${primary}.sig`), 'signature');
    }
    const manifest = await buildUpdaterManifest({
      version: '0.3.4',
      tag: 'v0.3.4',
      desktopRoot: testFixture.root,
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
        buildUpdaterManifest({ version: '0.3.4', tag: 'v0.3.4', desktopRoot: testFixture.root }),
        scenario.message,
      );
    } finally {
      testFixture.cleanup();
    }
  }
});
