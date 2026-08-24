import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  encodeSegment,
  materializeFixture,
  parseArguments,
  projectKey,
  seededSessionRowSelector,
  terminateProcess,
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
    const sourceFixture = fileURLToPath(new URL('../../web/tests/snapshots/navigation-panes/seed.jsonl', import.meta.url));
    const source = readFileSync(sourceFixture, 'utf8');
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

test('selects persisted rows from the main session tree', () => {
  assert.equal(
    seededSessionRowSelector(),
    '[role="tree"]:not([aria-label="Search results"]) [role="treeitem"][aria-selected="false"]',
  );
});

test('does not wait for an exit event that fired before cleanup started', async () => {
  const child = fakeChild();
  child.exitCode = 0;
  assert.equal(await terminateProcess(child), true);
  assert.deepEqual(child.kills, []);
});

test('gracefully terminates a live driver before the force deadline', async () => {
  const child = fakeChild((signal) => {
    if (signal !== 'SIGTERM') return;
    queueMicrotask(() => {
      child.exitCode = 0;
      child.emit('exit', 0, null);
    });
  });
  assert.equal(await terminateProcess(child, { graceMs: 20, forceMs: 20 }), true);
  assert.deepEqual(child.kills, ['SIGTERM']);
});

test('escalates and returns after a driver ignores both termination signals', async () => {
  const child = fakeChild();
  assert.equal(await terminateProcess(child, { graceMs: 1, forceMs: 1 }), false);
  assert.deepEqual(child.kills, ['SIGTERM', 'SIGKILL']);
});

function fakeChild(onKill = () => {}) {
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.kills = [];
  child.kill = (signal) => {
    child.kills.push(signal);
    onKill(signal);
    return true;
  };
  return child;
}
