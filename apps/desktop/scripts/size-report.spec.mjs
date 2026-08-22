import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { inspectArtifacts } from './size-report.mjs';
import { resolveTarget } from './target-spec.mjs';

function fixture() {
  const root = resolve(tmpdir(), `dsh-size-${process.pid}-${Date.now()}`);
  return {
    root,
    file(relative) {
      const path = join(root, relative);
      mkdirSync(resolve(path, '..'), { recursive: true });
      writeFileSync(path, 'artifact');
    },
    cleanup() { rmSync(root, { recursive: true, force: true }); },
  };
}

test('discovers every expected Linux bundle and separates signatures from installer bytes', () => {
  const testFixture = fixture();
  try {
    const target = resolveTarget('x86_64-unknown-linux-gnu');
    testFixture.file('src-tauri/target/x86_64-unknown-linux-gnu/release/bundle/appimage/dsh.AppImage');
    testFixture.file('src-tauri/target/x86_64-unknown-linux-gnu/release/bundle/appimage/dsh.AppImage.sig');
    testFixture.file('src-tauri/target/x86_64-unknown-linux-gnu/release/bundle/deb/dsh.deb');
    testFixture.file('src-tauri/target/x86_64-unknown-linux-gnu/release/bundle/deb/dsh.deb.sig');
    const result = inspectArtifacts(target, testFixture.root);
    assert.deepEqual(result.missing, []);
    assert.equal(result.compressedBytes, 'artifact'.length * 2);
  } finally {
    testFixture.cleanup();
  }
});

test('reports a missing expected artifact instead of accepting a partial bundle', () => {
  const testFixture = fixture();
  try {
    const target = resolveTarget('x86_64-pc-windows-msvc');
    testFixture.file('src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/dsh.exe');
    const result = inspectArtifacts(target, testFixture.root);
    assert.deepEqual(result.missing, ['.exe.sig']);
  } finally {
    testFixture.cleanup();
  }
});
