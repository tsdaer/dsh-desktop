import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import assert from 'node:assert/strict';
import { assertReplaceableFallbackEntry, mergeProfilePatch, parseArguments, sessionCookieFromResponse } from './evidence-server.mjs';

test('parseArguments uses the repository and fixed-port defaults', () => {
  const options = parseArguments([]);
  assert.equal(options.port, 4173);
  assert.equal(options.workspace.endsWith('deepseek-harness'), true);
  assert.equal(options.keepHome, false);
});

test('parseArguments accepts an explicit workspace and keep-home flag', () => {
  const options = parseArguments(['--port', '4311', '--workspace', '.', '--keep-home']);
  assert.equal(options.port, 4311);
  assert.equal(options.workspace, process.cwd());
  assert.equal(options.keepHome, true);
});

test('parseArguments accepts zero for an OS-assigned port', () => {
  assert.equal(parseArguments(['--port', '0']).port, 0);
});

test('parseArguments accepts the pnpm-forwarded option separator', () => {
  const options = parseArguments(['--', '--workspace', '.', '--keep-home']);
  assert.equal(options.workspace, process.cwd());
  assert.equal(options.keepHome, true);
});

test('mergeProfilePatch replaces the profile empty list and stays idempotent', () => {
  const patch = '- insert:\n    - id: desktop-bridge\n';
  const merged = mergeProfilePatch('# header\n[]\n', patch);
  assert.equal(merged, '# header\n- insert:\n    - id: desktop-bridge\n');
  assert.equal(mergeProfilePatch(merged, patch), merged);
});

test('fallback validation allows a missing entry and rejects a regular entry', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-evidence-test-'));
  try {
    assert.doesNotThrow(() => assertReplaceableFallbackEntry(join(root, 'missing')));
    const regular = join(root, 'regular');
    writeFileSync(regular, 'not a link\n');
    assert.throws(
      () => assertReplaceableFallbackEntry(regular),
      /is not a symlink; evidence setup will not replace it/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('session cookie extraction keeps only the cookie pair from the startup exchange', () => {
  const response = new Response(null, {
    headers: { 'set-cookie': 'dsh-auth-example=session-value; Path=/; HttpOnly' },
  });
  assert.equal(sessionCookieFromResponse(response), 'dsh-auth-example=session-value');
});
