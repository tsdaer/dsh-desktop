import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  advanceSeededSessionNavigation,
  encodeSegment,
  materializeFixture,
  nativeUiDriverEnvironment,
  parseArguments,
  projectKey,
  seededSessionGroupSelector,
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
    assert.equal(materialized.patchPath, join(home, 'cordis.patch.yml'));
    assert.match(readFileSync(materialized.patchPath, 'utf8'), /compression: none/);
    assert.match(materialized.sessionPath, new RegExp(`${projectKey(join(home, 'workspace', 'workspace'))}`));
    assert.match(materialized.sessionPath, new RegExp(encodeSegment(materialized.sessionId)));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('passes the plaintext fixture overlay through the installed shell environment', () => {
  assert.deepEqual(
    nativeUiDriverEnvironment('/tmp/native-home', '/tmp/native-home/cordis.patch.yml', {
      PATH: '/usr/bin',
      DSH_HOME: '/ambient/home',
      DSH_PATCH: '/ambient/patch.yml',
    }),
    {
      PATH: '/usr/bin',
      DSH_HOME: '/tmp/native-home',
      DSH_PATCH: '/tmp/native-home/cordis.patch.yml',
      DSH_TELEMETRY_DISABLED: '1',
      WEBKIT_DISABLE_DMABUF_RENDERER: '1',
    },
  );
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

test('selects persisted rows from the main session tree in either selection state', () => {
  assert.equal(
    seededSessionRowSelector(),
    '[role="tree"]:not([aria-label="Search results"]) [role="treeitem"][aria-selected]',
  );
  assert.equal(
    seededSessionGroupSelector(),
    '[role="tree"]:not([aria-label="Search results"]) [role="treeitem"][aria-expanded]',
  );
});

test('expands the sole collapsed group before opening its persisted session', () => {
  let expanded = false;
  let opened = false;
  const group = {
    click: () => { expanded = true; },
    textContent: 'Ungrouped',
    getAttribute: (name) => name === 'aria-expanded' ? String(expanded) : null,
  };
  const row = {
    click: () => { opened = true; },
    textContent: 'NavScenario',
    getAttribute: () => null,
  };
  const documentRoot = {
    querySelectorAll: (selector) => selector.includes('[aria-selected]')
      ? (expanded ? [row] : [])
      : [group],
  };
  assert.deepEqual(
    advanceSeededSessionNavigation(documentRoot, seededSessionRowSelector(), seededSessionGroupSelector()),
    {
      count: 0,
      labels: [],
      groupCount: 1,
      groupLabels: ['Ungrouped'],
      expanded: true,
      clicked: false,
    },
  );
  assert.deepEqual(
    advanceSeededSessionNavigation(documentRoot, seededSessionRowSelector(), seededSessionGroupSelector()),
    {
      count: 1,
      labels: ['NavScenario'],
      groupCount: 1,
      groupLabels: ['Ungrouped'],
      expanded: false,
      clicked: true,
    },
  );
  assert.equal(opened, true);
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
