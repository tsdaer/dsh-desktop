import assert from 'node:assert/strict';
import test from 'node:test';

import { parseArguments, parseGlibcVersion, readLinuxBaseline, renderLinuxBaseline } from './linux-baseline.mjs';

test('accepts an explicit output file without changing target selection', () => {
  const options = parseArguments([
    '--target', 'x86_64-unknown-linux-gnu', '--output', 'artifacts/linux-baseline.json',
  ]);
  assert.equal(options.target.rustTriple, 'x86_64-unknown-linux-gnu');
  assert.match(options.output, /artifacts[\\/]linux-baseline\.json$/);
  assert.throws(() => parseArguments([
    '--target', 'x86_64-unknown-linux-gnu', '--output',
  ]), /--output requires/);
});

test('renders the target and measured prerequisites as durable JSON', () => {
  const target = { rustTriple: 'x86_64-unknown-linux-gnu' };
  const baseline = {
    platform: 'linux',
    glibc: '2.39',
    libraries: { 'glib-2.0': '2.80.0' },
    commands: ['pkg-config'],
  };
  assert.deepEqual(JSON.parse(renderLinuxBaseline(target, baseline)), {
    target: 'x86_64-unknown-linux-gnu',
    ...baseline,
  });
});

test('parses common glibc version banners', () => {
  assert.equal(parseGlibcVersion('ldd (Ubuntu GLIBC 2.39-0ubuntu8.6) 2.39'), '2.39');
  assert.equal(parseGlibcVersion('GNU libc 2.36\nCopyright'), '2.36');
  assert.throws(() => parseGlibcVersion('musl libc (x86_64)'), /did not report/);
});

test('records Linux runtime libraries and packaging tools through the injected runner', () => {
  const outputs = new Map([
    ['ldd --version', 'ldd (Ubuntu GLIBC 2.39-0ubuntu8.6) 2.39'],
    ['pkg-config --modversion glib-2.0', '2.80.0'],
    ['pkg-config --modversion gtk+-3.0', '3.24.41'],
    ['pkg-config --modversion webkit2gtk-4.1', '2.44.5'],
    ['pkg-config --version', '1.8.1'],
    ['dpkg-deb --version', 'Debian dpkg-deb 1.22.6'],
    ['patchelf --version', 'patchelf 0.18.0'],
    ['xvfb-run --help', 'Usage: xvfb-run [OPTION ...] COMMAND'],
  ]);
  const baseline = readLinuxBaseline({
    platform: 'linux',
    run: (command, args) => outputs.get([command, ...args].join(' ')) ?? '',
  });
  assert.deepEqual(baseline, {
    platform: 'linux',
    glibc: '2.39',
    libraries: {
      'glib-2.0': '2.80.0',
      'gtk+-3.0': '3.24.41',
      'webkit2gtk-4.1': '2.44.5',
    },
    commands: ['pkg-config', 'dpkg-deb', 'patchelf', 'xvfb-run'],
  });
});

test('fails closed for non-Linux hosts and missing prerequisites', () => {
  assert.throws(() => readLinuxBaseline({ platform: 'win32', run: () => '' }), /requires a Linux runner/);
  assert.throws(() => readLinuxBaseline({
    platform: 'linux',
    run: () => '',
  }), /glibc version/);
});
