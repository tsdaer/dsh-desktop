import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  encodeSegment,
  materializeFixture,
  parseArguments,
  projectKey,
  webdriverCapabilities,
} from './tauri-ui-smoke.mjs';

test('accepts only the Linux x64 deb target and keeps optional paths explicit', () => {
  const options = parseArguments([
    '--target', 'x86_64-unknown-linux-gnu',
    '--artifact', 'dist/dsh-desktop.deb',
    '--fixture', 'fixtures/session.jsonl',
    '--screenshot', 'artifacts/native-ui.png',
    '--port', '4555',
    '--home', 'artifacts/home',
  ]);
  assert.equal(options.target.rustTriple, 'x86_64-unknown-linux-gnu');
  assert.match(options.artifact, /dist[\\/]dsh-desktop\.deb$/);
  assert.match(options.fixture, /fixtures[\\/]session\.jsonl$/);
  assert.match(options.screenshot, /artifacts[\\/]native-ui\.png$/);
  assert.equal(options.port, 4555);
  assert.match(options.home, /artifacts[\\/]home$/);
  assert.throws(
    () => parseArguments(['--target', 'x86_64-unknown-linux-gnu', '--artifact', 'dsh.AppImage']),
    /requires a deb artifact/,
  );
  assert.throws(
    () => parseArguments(['--target', 'aarch64-apple-darwin', '--artifact', 'dsh.deb']),
    /supports Linux x64 only/,
  );
});

test('materializes the committed session fixture without path tokens', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-tauri-ui-fixture-'));
  try {
    const fixture = join(root, 'seed.jsonl');
    const home = join(root, 'home');
    const source = readFileSync('apps/web/tests/snapshots/navigation-panes/seed.jsonl', 'utf8');
    writeFileSync(fixture, source, { encoding: 'utf8' });
    const materialized = materializeFixture(home, fixture);
    const stored = readFileSync(materialized.sessionPath, 'utf8');
    assert.equal(stored.includes('{{sessionId}}'), false);
    assert.equal(stored.includes('{{cwd}}'), false);
    assert.match(readFileSync(join(home, 'cordis.patch.yml'), 'utf8'), /compression: none/);
    assert.match(materialized.sessionPath, new RegExp(`${projectKey(join(home, 'workspace', 'workspace'))}`));
    assert.match(materialized.sessionPath, new RegExp(encodeSegment(materialized.sessionId)));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('uses the W3C Tauri application capability without an ambient browser', () => {
  assert.deepEqual(webdriverCapabilities('/usr/lib/dsh-desktop/bin/dsh-desktop'), {
    capabilities: {
      alwaysMatch: {
        'tauri:options': { application: '/usr/lib/dsh-desktop/bin/dsh-desktop' },
      },
    },
  });
});
