import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeProfilePatch, parseArguments } from './evidence-server.mjs';

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
