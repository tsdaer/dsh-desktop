// Coordinate a target-native installed update smoke around the existing
// updater fixture and packaged application smoke. The current package must
// already contain the fixture endpoint; this command only serves the signed
// next-version artifact and drives the installed package.
import { existsSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { loadFixture, serveUpdateFixture } from './update-fixture.mjs';
import { resolveTargetFromArgs } from './target-spec.mjs';

const versionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const scriptDirectory = dirname(fileURLToPath(import.meta.url));

/**
 * Parse the two package paths and the fixed loopback port needed for an
 * installed update smoke. A fixed port keeps the endpoint embedded in the
 * version-N package equal to the fixture server used by this command.
 *
 * @param {readonly string[]} argv Arguments after the script name.
 * @returns {{target: Readonly<object>, artifact: string, nextVersion: string, artifactRoot: string, manifestPath: string, host: string, port: number, terminalSmoke: boolean}}
 */
export function parseArguments(argv) {
  const target = resolveTargetFromArgs(argv);
  const artifact = requiredValue(argv, '--artifact');
  const nextVersion = requiredValue(argv, '--next-version');
  if (!versionPattern.test(nextVersion)) throw new Error(`invalid next update version: ${nextVersion}`);
  const artifactRoot = resolve(valueFor(argv, '--artifact-root') ?? 'dist');
  const manifestPath = resolve(valueFor(argv, '--manifest') ?? `${artifactRoot}/latest.json`);
  const host = valueFor(argv, '--host') ?? '127.0.0.1';
  if (host !== '127.0.0.1' && host !== '::1') throw new Error('--host must be a loopback address');
  const portValue = requiredValue(argv, '--port');
  const port = Number(portValue);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('--port must be an integer from 1 to 65535');
  const terminalSmoke = argv.includes('--terminal-smoke');
  validateArtifactSuffix(artifact, target);
  return {
    target,
    artifact: resolve(artifact),
    nextVersion,
    artifactRoot,
    manifestPath,
    host,
    port,
    terminalSmoke,
  };
}

/**
 * Build the argument vector for the existing packaged smoke driver.
 *
 * @param {{target: Readonly<object>, artifact: string, nextVersion: string, terminalSmoke?: boolean}} options Parsed update-smoke options.
 * @returns {readonly string[]} Arguments that do not pass through a shell.
 */
export function packagedSmokeArguments(options) {
  const args = [
    '--target', options.target.rustTriple,
    '--artifact', options.artifact,
    '--update-smoke',
    '--expected-version', options.nextVersion,
  ];
  const install = installationFlag(options.target, options.artifact);
  if (install !== undefined) args.splice(4, 0, install);
  if (options.terminalSmoke) args.push('--terminal-smoke');
  return args;
}

/**
 * Run the existing packaged smoke driver and preserve its output for CI.
 *
 * @param {{target: Readonly<object>, artifact: string, nextVersion: string, terminalSmoke?: boolean}} options Parsed update-smoke options.
 * @param {{spawnProcess?: typeof spawn, script?: string}} [dependencies] Injectable process launcher for tests.
 * @returns {Promise<string>} Combined stdout and stderr.
 */
export function runPackagedSmoke(options, { spawnProcess = spawn, script = `${scriptDirectory}/packaged-smoke.mjs` } = {}) {
  const child = spawnProcess(process.execPath, [script, ...packagedSmokeArguments(options)], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let output = '';
  child.stdout?.on('data', (chunk) => { output += String(chunk); });
  child.stderr?.on('data', (chunk) => { output += String(chunk); });
  return new Promise((resolveOutput, rejectOutput) => {
    child.once('error', rejectOutput);
    child.once('close', (code, signal) => {
      if (code === 0) {
        resolveOutput(output);
        return;
      }
      rejectOutput(new Error(`packaged update smoke failed (code=${code}, signal=${signal})\n${output}`));
    });
  });
}

/**
 * Serve the signed next-version fixture, run the installed version-N package,
 * and close the server on both success and failure.
 *
 * @param {{target: Readonly<object>, artifact: string, nextVersion: string, artifactRoot: string, manifestPath: string, host: string, port: number, terminalSmoke?: boolean}} options Parsed update-smoke options.
 * @param {{load?: typeof loadFixture, serve?: typeof serveUpdateFixture, run?: typeof runPackagedSmoke}} [dependencies] Injectable fixture and process operations for tests.
 * @returns {Promise<{manifestUrl: string, output: string}>} Fixture endpoint and packaged smoke output.
 */
export async function runUpdateSmoke(options, {
  load = loadFixture,
  serve = serveUpdateFixture,
  run = runPackagedSmoke,
} = {}) {
  const fixture = await load({
    target: options.target,
    version: options.nextVersion,
    artifactRoot: options.artifactRoot,
    manifestPath: options.manifestPath,
  });
  const served = await serve({ fixture, host: options.host, port: options.port });
  try {
    const output = await run(options);
    return { manifestUrl: served.url, output };
  } finally {
    await closeServer(served.server);
  }
}

function installationFlag(target, artifact) {
  if (target.productTarget === 'windows-x64') return '--install-nsis';
  if (target.productTarget === 'linux-x64' && artifact.endsWith('.deb')) return '--install-deb';
  if (target.productTarget === 'macos-arm64' && artifact.endsWith('.dmg')) return '--install-dmg';
  return undefined;
}

function validateArtifactSuffix(artifact, target) {
  const valid = target.productTarget === 'windows-x64'
    ? artifact.endsWith('.exe')
    : target.productTarget === 'linux-x64'
      ? artifact.endsWith('.AppImage') || artifact.endsWith('.deb')
      : artifact.endsWith('.app') || artifact.endsWith('.dmg');
  if (!valid) throw new Error(`artifact does not match ${target.productTarget}: ${artifact}`);
}

function requiredValue(argv, name) {
  const value = valueFor(argv, name);
  if (value === undefined) throw new Error(`${name} requires a value`);
  return value;
}

function valueFor(argv, name) {
  const index = argv.indexOf(name);
  if (index < 0) return undefined;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('-')) throw new Error(`${name} requires a value`);
  return value;
}

async function closeServer(server) {
  await new Promise((resolveClose, rejectClose) => {
    server.close((error) => error == null ? resolveClose() : rejectClose(error));
  });
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (!existsSync(options.artifact) || statSync(options.artifact).size === 0) {
    throw new Error(`version-N package artifact is missing or empty: ${options.artifact}`);
  }
  const result = await runUpdateSmoke(options);
  console.log(`[update-smoke] fixture: ${result.manifestUrl}`);
  process.stdout.write(result.output);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`[update-smoke] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
