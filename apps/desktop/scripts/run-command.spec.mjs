import assert from 'node:assert/strict';
import test from 'node:test';

import { runCommand } from './run-command.mjs';

test('accepts inherited stdio for installer commands', () => {
  assert.equal(runCommand(process.execPath, ['-e', 'process.stdout.write(\'\')'], { stdio: 'inherit' }), '');
});

test('captures installed package inventories beyond the child process default buffer', () => {
  const bytes = 2 * 1024 * 1024;
  assert.equal(
    runCommand(process.execPath, ['-e', `process.stdout.write('x'.repeat(${bytes}))`]).length,
    bytes,
  );
});
