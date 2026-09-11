import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  advanceApiKeyOnboarding,
  advanceWelcomeNotice,
  advanceSeededSessionNavigation,
  encodeSegment,
  highestGenerationFixture,
  isClosedWindowError,
  materializeFixture,
  nativeUiDriverEnvironment,
  parseArguments,
  persistedLogName,
  projectKey,
  redactNativeUiDiagnostics,
  realizePersistedFixture,
  seededSessionGroupSelector,
  seededSessionRowSelector,
  seededSessionTreeSelector,
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
    const scenario = fileURLToPath(new URL('../../../snapshots/web/navigation-panes/', import.meta.url));
    const sourceFixture = highestGenerationFixture(scenario);
    const source = readFileSync(sourceFixture, 'utf8');
    const recordedHeader = JSON.parse(source.split('\n', 1)[0]);
    writeFileSync(fixture, source, { encoding: 'utf8' });
    const materialized = materializeFixture(home, fixture);
    const stored = readFileSync(materialized.sessionPath, 'utf8');
    const header = JSON.parse(stored.split('\n', 1)[0]);
    assert.deepEqual(header, {
      type: 'session',
      version: recordedHeader.version,
      id: 'dsh-desktop-native-ui',
      createdAt: recordedHeader.createdAt,
      isSeeded: false,
      cwd: join(home, 'workspace', 'workspace'),
      delegationDepth: 0,
      agentPreset: 'standard',
    });
    assert.equal(stored.includes('{{sessionId}}'), false);
    assert.equal(stored.includes('{{cwd}}'), false);
    // Projected fixtures omit envelopes; the realized log must carry contiguous
    // seq on every event so the JSONL backend can commit the whole session.
    const storedEvents = stored.split(String.fromCharCode(10)).slice(1).filter(line => line.trim().length > 0);
    assert.ok(storedEvents.length > 0, 'realized fixture must contain events');
    let nextSeq = 0;
    for (const line of storedEvents) {
      const record = JSON.parse(line);
      const packed = record.type === 'text-chunks' || record.type === 'reasoning-chunks' || record.type === 'tool-call-chunks';
      const seq = packed ? record.seq0 : record.seq;
      assert.equal(seq, nextSeq, record.type + ' must carry contiguous seq');
      nextSeq += packed ? record.data.texts?.length ?? record.data.args?.length ?? 1 : 1;
    }
    const records = storedEvents.map(line => JSON.parse(line));
    const assistant = records.find(record => record.type === 'assistant/message');
    const toolResult = records.find(record => record.type === 'tool/result');
    assert.equal(assistant?.data.message.role, 'assistant');
    assert.equal(toolResult?.data.message.content[0].type, 'tool-result');
    assert.equal(materialized.sessionPath, join(home, 'sessions', projectKey(join(home, 'workspace', 'workspace')), encodeSegment(materialized.sessionId), persistedLogName(recordedHeader.version)));
    assert.equal(materialized.patchPath, join(home, 'cordis.patch.yml'));
    assert.match(readFileSync(materialized.patchPath, 'utf8'), /compression: none/);
    assert.match(materialized.sessionPath, new RegExp(`${projectKey(join(home, 'workspace', 'workspace'))}`));
    assert.match(materialized.sessionPath, new RegExp(encodeSegment(materialized.sessionId)));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('names the seeded log by its declared generation', () => {
  assert.equal(persistedLogName(0), 'session.jsonl');
  assert.equal(persistedLogName(3), 'session.v3.jsonl');
  assert.throws(() => persistedLogName(-1), /non-negative safe integer/);
  assert.throws(() => persistedLogName(1.5), /non-negative safe integer/);
});

test('advances seq past the line count when a fixture carries packed chunk rows', () => {
  const header = JSON.stringify({ type: 'session', version: 3, id: '{{sessionId}}', createdAt: 0, cwd: '{{cwd}}' });
  const packed = JSON.stringify({ type: 'text-chunks', data: { texts: ['a', 'b', 'c'] } });
  const ordinary = JSON.stringify({ type: 'turn/start', data: {} });
  const realized = realizePersistedFixture([header, packed, ordinary].join('\n'), '/tmp/workspace', 'smoke');
  const rows = realized.split('\n').slice(1).map(line => JSON.parse(line));
  assert.deepEqual(rows.map(row => row.type === 'text-chunks' ? row.seq0 : row.seq), [0, 3]);
});

test('selects the highest recorded generation of a scenario fixture', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-tauri-ui-generation-'));
  try {
    writeFileSync(join(root, 'session.jsonl'), '{}\n');
    writeFileSync(join(root, 'session.v2.jsonl'), '{}\n');
    writeFileSync(join(root, 'session.v3.jsonl'), '{}\n');
    writeFileSync(join(root, 'session.1.v3.jsonl'), '{}\n');
    writeFileSync(join(root, 'snapshot.yml'), 'version: 1\n');
    assert.equal(highestGenerationFixture(root), join(root, 'session.v3.jsonl'));
    rmSync(join(root, 'session.v3.jsonl'));
    assert.equal(highestGenerationFixture(root), join(root, 'session.v2.jsonl'));
    rmSync(join(root, 'session.v2.jsonl'));
    assert.equal(highestGenerationFixture(root), join(root, 'session.jsonl'));
    rmSync(join(root, 'session.jsonl'));
    assert.throws(() => highestGenerationFixture(root), /no canonical session/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects a recorded fixture without a usable session header', () => {
  assert.throws(
    () => realizePersistedFixture('{"type":"turn/start"}\n', '/tmp/workspace', 'session-id'),
    /must start with a versioned session header/,
  );
});

test('passes an isolated plaintext fixture environment to the installed shell', () => {
  assert.deepEqual(
    nativeUiDriverEnvironment('/tmp/native-home', '/tmp/native-home/cordis.patch.yml', {
      PATH: '/usr/bin',
      DSH_HOME: '/ambient/home',
      DSH_PATCH: '/ambient/patch.yml',
      DEEPSEEK_API_KEY: 'must-not-reach-the-installed-app',
      GITHUB_TOKEN: 'must-not-reach-the-installed-app',
    }),
    {
      PATH: '/usr/bin',
      DSH_HOME: '/tmp/native-home',
      DSH_PATCH: '/tmp/native-home/cordis.patch.yml',
      DSH_TELEMETRY_DISABLED: '1',
      TMPDIR: '/tmp/native-home',
      WEBKIT_DISABLE_DMABUF_RENDERER: '1',
    },
  );
});

test('redacts the per-boot loopback credential from failure diagnostics', () => {
  assert.equal(
    redactNativeUiDiagnostics('ready http://127.0.0.1:1234/?dsh_token=secret&view=main DSH_WEB_TOKEN: second'),
    'ready http://127.0.0.1:1234/?dsh_token=<redacted>&view=main DSH_WEB_TOKEN: <redacted>',
  );
});

test('acknowledges the fresh-home testing notice in either supported locale', () => {
  let clicks = 0;
  const documentRoot = {
    querySelectorAll: () => [{ textContent: '继续', disabled: false, click: () => { clicks += 1; } }],
  };
  assert.deepEqual(
    advanceWelcomeNotice(documentRoot),
    { present: true, disabled: false, clicked: true },
  );
  assert.equal(clicks, 1);
  assert.deepEqual(
    advanceWelcomeNotice({ querySelectorAll: () => [] }),
    { present: false, disabled: false, clicked: false },
  );
});

test('defers API key configuration in either supported locale', () => {
  let clicks = 0;
  const documentRoot = {
    querySelectorAll: () => [{ textContent: 'Configure later', disabled: false, click: () => { clicks += 1; } }],
  };
  assert.deepEqual(
    advanceApiKeyOnboarding(documentRoot),
    { present: true, disabled: false, clicked: true },
  );
  assert.equal(clicks, 1);
  assert.deepEqual(
    advanceApiKeyOnboarding({ querySelectorAll: () => [] }),
    { present: false, disabled: false, clicked: false },
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

test('retries only the WebDriver error produced by a closing splash window', () => {
  assert.equal(isClosedWindowError(new Error(
    'WebDriver POST /session/id/execute/sync failed: {"value":{"error":"no such window","message":""}}',
  )), true);
  assert.equal(isClosedWindowError(new Error(
    'WebDriver POST /session/id/execute/sync failed: {"value":{"error":"javascript error"}}',
  )), false);
  assert.equal(isClosedWindowError('no such window'), false);
});

test('selects persisted rows from the main session tree in either selection state', () => {
  assert.equal(
    seededSessionTreeSelector(),
    '[role="tree"][aria-label="Sessions"], [role="tree"][aria-label="会话"]',
  );
  assert.equal(
    seededSessionRowSelector(),
    '[role="treeitem"][aria-selected]',
  );
  assert.equal(
    seededSessionGroupSelector(),
    '[role="treeitem"][aria-expanded]',
  );
});

test('scopes navigation to Sessions and ignores its provisional New Session row', () => {
  let expanded = false;
  let opened = false;
  const group = {
    click: () => { expanded = true; },
    textContent: 'Ungrouped',
    getAttribute: (name) => name === 'aria-expanded' ? String(expanded) : null,
    querySelector: () => null,
  };
  const blankRow = {
    click: () => {},
    textContent: 'New Session',
    getAttribute: () => null,
    querySelector: () => null,
  };
  const persistedRow = {
    click: () => { opened = true; },
    textContent: 'NavScenario',
    getAttribute: () => null,
    querySelector: (selector) => selector === 'button' ? {} : null,
  };
  const sessionTree = {
    querySelectorAll: (selector) => selector.includes('[aria-selected]')
      ? (expanded ? [blankRow, persistedRow] : [])
      : [group],
  };
  const documentRoot = {
    querySelectorAll: (selector) => selector === seededSessionTreeSelector() ? [sessionTree] : [],
  };
  assert.deepEqual(
    advanceSeededSessionNavigation(
      documentRoot,
      seededSessionTreeSelector(),
      seededSessionRowSelector(),
      seededSessionGroupSelector(),
    ),
    {
      treeCount: 1,
      count: 0,
      labels: [],
      persistedCount: 0,
      groupCount: 1,
      groupLabels: ['Ungrouped'],
      expanded: true,
      clicked: false,
    },
  );
  assert.deepEqual(
    advanceSeededSessionNavigation(
      documentRoot,
      seededSessionTreeSelector(),
      seededSessionRowSelector(),
      seededSessionGroupSelector(),
    ),
    {
      treeCount: 1,
      count: 2,
      labels: ['New Session', 'NavScenario'],
      persistedCount: 1,
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
