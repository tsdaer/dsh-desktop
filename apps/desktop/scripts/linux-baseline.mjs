// Record the Linux runner prerequisites used by the target-native desktop
// build. This is a host check: it does not claim compatibility with a
// distribution that was not actually inspected.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

import { resolveTargetFromArgs } from './target-spec.mjs';

const REQUIRED_LIBRARIES = Object.freeze(['glib-2.0', 'gtk+-3.0', 'webkit2gtk-4.1']);
const REQUIRED_COMMANDS = Object.freeze([
  ['pkg-config', ['--version']],
  ['dpkg-deb', ['--version']],
  ['patchelf', ['--version']],
  ['xvfb-run', ['--help']],
]);

/**
 * Parse the Linux baseline command options.
 *
 * @param {readonly string[]} argv Arguments after the script name.
 * @returns {{target: Readonly<object>, output?: string}}
 */
export function parseArguments(argv) {
  const target = resolveTargetFromArgs(argv);
  const outputIndex = argv.indexOf('--output');
  if (outputIndex < 0) return { target };
  const output = argv[outputIndex + 1];
  if (output === undefined || output.startsWith('-')) throw new Error('--output requires a file path');
  return { target, output: resolve(output) };
}

/**
 * Render a durable baseline record for one validated target.
 *
 * @param {{readonly rustTriple: string}} target Resolved Linux target.
 * @param {Readonly<{platform: string, glibc: string, libraries: Readonly<Record<string, string>>, commands: readonly string[]}>} baseline Host measurements.
 * @returns {string} Pretty-printed JSON with one trailing newline.
 */
export function renderLinuxBaseline(target, baseline) {
  return `${JSON.stringify({ target: target.rustTriple, ...baseline }, null, 2)}\n`;
}

/**
 * Parse the glibc version printed by the host's ldd implementation.
 *
 * @param {string} output Combined stdout and stderr from `ldd --version`.
 * @returns {string}
 */
export function parseGlibcVersion(output) {
  const match = output.match(/\b(?:GLIBC|GNU libc)\s+(\d+\.\d+)\b/i)
    ?? output.match(/\bldd\s+\([^)]*\)\s+(\d+\.\d+)\b/i);
  if (!match) throw new Error('ldd --version did not report a glibc version');
  return match[1];
}

/**
 * Read one Linux desktop build environment through an injected command
 * runner. The returned values are release evidence and are not inferred from
 * the host operating-system name.
 *
 * @param {{platform?: string, run?: (command: string, args: readonly string[]) => string}} [options]
 * @returns {{platform: 'linux', glibc: string, libraries: Readonly<Record<string, string>>, commands: readonly string[]}}
 */
export function readLinuxBaseline({ platform = process.platform, run = runCommand } = {}) {
  if (platform !== 'linux') throw new Error(`Linux baseline check requires a Linux runner, got ${platform}`);

  const glibc = parseGlibcVersion(run('ldd', ['--version']));
  const libraries = Object.fromEntries(REQUIRED_LIBRARIES.map((library) => {
    const version = runRequired(run, 'pkg-config', ['--modversion', library], `pkg-config library ${library}`);
    if (!/^\d+(?:\.\d+)+(?:[-+._A-Za-z0-9]*)?$/.test(version)) {
      throw new Error(`pkg-config library ${library} reported an invalid version: ${version}`);
    }
    return [library, version];
  }));

  for (const [command, args] of REQUIRED_COMMANDS) runRequired(run, command, args, command);
  return { platform: 'linux', glibc, libraries, commands: REQUIRED_COMMANDS.map(([command]) => command) };
}

function runRequired(run, command, args, subject) {
  try {
    const output = run(command, args).trim();
    if (output.length === 0) throw new Error('no output');
    return output.split(/\r?\n/, 1)[0];
  } catch (error) {
    throw new Error(`Linux desktop prerequisite ${subject} is unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function runCommand(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const output = [result.stdout, result.stderr].filter((value) => typeof value === 'string').join('\n');
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(output || `${command} ${args.join(' ')} failed`);
  return output;
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const target = options.target;
  if (target.productTarget !== 'linux-x64') {
    throw new Error(`Linux baseline check currently supports Linux x64 only: ${target.rustTriple}`);
  }
  const baseline = readLinuxBaseline();
  const rendered = renderLinuxBaseline(target, baseline);
  if (options.output !== undefined) {
    mkdirSync(dirname(options.output), { recursive: true });
    writeFileSync(options.output, rendered, { encoding: 'utf8' });
    console.log(`[linux-baseline] wrote ${options.output}`);
  }
  console.log(`[linux-baseline] ${JSON.stringify({ target: target.rustTriple, ...baseline })}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    console.error(`[linux-baseline] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
