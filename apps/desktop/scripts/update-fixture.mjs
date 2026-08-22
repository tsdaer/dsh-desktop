// Serve one target's signed updater artifact set from a loopback fixture.
// The fixture is deliberately separate from the production release URL so a
// target runner can exercise updater selection without mutating a published
// release.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { resolveTarget } from './target-spec.mjs';
import { DEFAULT_UPDATER_PUBLIC_KEY, verifyMinisignSignature } from './updater-manifest.mjs';

const defaultPort = 0;
const defaultHost = '127.0.0.1';

/**
 * Parse the explicit target and next-version fixture options.
 *
 * @param {readonly string[]} argv Arguments after the script name.
 * @returns {{target: Readonly<object>, version: string, artifactRoot: string, manifestPath: string, host: string, port: number}}
 */
export function parseArguments(argv) {
  const target = readTarget(argv);
  const version = valueFor(argv, '--version');
  if (version === undefined || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error('--version requires a valid desktop version');
  }
  const artifactRoot = resolve(valueFor(argv, '--artifact-root') ?? 'dist');
  const manifestPath = resolve(valueFor(argv, '--manifest') ?? join(artifactRoot, 'latest.json'));
  const host = valueFor(argv, '--host') ?? defaultHost;
  if (host !== defaultHost && host !== '::1') throw new Error('--host must be a loopback address');
  const portValue = valueFor(argv, '--port');
  const port = portValue === undefined ? defaultPort : Number(portValue);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('--port must be an integer from 0 to 65535');
  return { target, version, artifactRoot, manifestPath, host, port };
}

/**
 * Validate and select one target row from a signed updater manifest.
 *
 * @param {{target: Readonly<object>, version: string, artifactRoot: string, manifestPath: string, publicKey?: string}} input
 * @returns {Promise<{target: Readonly<object>, version: string, artifactPath: string, signaturePath: string, manifest: Record<string, unknown>}>}
 */
export async function loadFixture(input) {
  const manifest = JSON.parse(await readFile(input.manifestPath, 'utf8'));
  if (!isRecord(manifest) || manifest.version !== input.version) {
    throw new Error(`fixture manifest version does not match ${input.version}`);
  }
  const platforms = manifest.platforms;
  const release = isRecord(platforms) ? platforms[input.target.updaterPlatform] : undefined;
  if (!isRecord(release) || typeof release.url !== 'string' || typeof release.signature !== 'string') {
    throw new Error(`fixture manifest has no signed ${input.target.updaterPlatform} entry`);
  }
  const artifactName = artifactNameFromUrl(release.url);
  const targetRoot = resolve(input.artifactRoot, input.target.productTarget);
  const artifactPath = join(targetRoot, artifactName);
  const signaturePath = `${artifactPath}.sig`;
  if (!isDirectChild(targetRoot, artifactPath) || !isDirectChild(targetRoot, signaturePath)) {
    throw new Error(`fixture updater artifact must remain inside ${targetRoot}`);
  }
  await requireNonEmptyFile(artifactPath, 'fixture updater artifact');
  await requireNonEmptyFile(signaturePath, 'fixture updater signature');
  if (!artifactName.includes(input.version)) throw new Error(`fixture artifact ${artifactName} does not contain ${input.version}`);
  const signature = await readFile(signaturePath, 'utf8');
  if (signature.trim() !== release.signature.trim()) throw new Error(`fixture signature does not match ${artifactName}`);
  verifyMinisignSignature(await readFile(artifactPath), signature, input.publicKey ?? defaultPublicKey(), artifactName);
  const fixtureManifest = {
    version: manifest.version,
    notes: typeof manifest.notes === 'string' ? manifest.notes : `dsh-desktop v${input.version}`,
    pub_date: typeof manifest.pub_date === 'string' ? manifest.pub_date : new Date().toISOString(),
    platforms: {
      [input.target.updaterPlatform]: {
        signature: release.signature,
        url: '',
      },
    },
  };
  return { target: input.target, version: input.version, artifactPath, signaturePath, manifest: fixtureManifest };
}

/**
 * Start a loopback HTTP server for one validated update fixture.
 *
 * @param {{fixture: Awaited<ReturnType<typeof loadFixture>>, host?: string, port?: number}} input
 * @returns {Promise<{server: import('node:http').Server, url: string, manifest: Record<string, unknown>}>}
 */
export async function serveUpdateFixture({ fixture, host = defaultHost, port = defaultPort }) {
  const artifactName = basename(fixture.artifactPath);
  const manifest = structuredClone(fixture.manifest);
  manifest.platforms[fixture.target.updaterPlatform].url = `http://${host}:${port}/artifacts/${encodeURIComponent(artifactName)}`;
  const server = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? '/', `http://${host}`);
      if (requestUrl.pathname === '/latest.json') {
        response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        response.end(`${JSON.stringify(manifest)}\n`);
        return;
      }
      const prefix = '/artifacts/';
      if (requestUrl.pathname.startsWith(prefix)
        && decodeURIComponent(requestUrl.pathname.slice(prefix.length)) === artifactName) {
        const bytes = await readFile(fixture.artifactPath);
        response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': bytes.byteLength, 'cache-control': 'no-store' });
        response.end(bytes);
        return;
      }
      response.writeHead(404);
      response.end('not found\n');
    } catch (error) {
      response.writeHead(400);
      response.end(`${error instanceof Error ? error.message : String(error)}\n`);
    }
  });
  await new Promise((resolveServer, rejectServer) => {
    server.once('error', rejectServer);
    server.listen(port, host, () => {
      server.removeListener('error', rejectServer);
      resolveServer();
    });
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    server.close();
    throw new Error('update fixture server did not expose a loopback address');
  }
  const base = `http://${host}:${address.port}`;
  manifest.platforms[fixture.target.updaterPlatform].url = `${base}/artifacts/${encodeURIComponent(artifactName)}`;
  return { server, url: `${base}/latest.json`, manifest };
}

async function requireNonEmptyFile(path, subject) {
  const info = await stat(path).catch(() => undefined);
  if (info === undefined || !info.isFile() || info.size === 0) throw new Error(`${subject} is missing or empty: ${path}`);
}

function artifactNameFromUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`fixture updater URL is invalid: ${value}`); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`fixture updater URL must use HTTP(S): ${value}`);
  if (url.search || url.hash) throw new Error(`fixture updater URL must not contain a query or fragment: ${value}`);
  const name = decodeURIComponent(url.pathname.split('/').pop() ?? '');
  if (name.length === 0 || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
    throw new Error(`fixture updater URL does not name a direct artifact: ${value}`);
  }
  return name;
}

function isDirectChild(root, path) {
  return resolve(path).startsWith(`${resolve(root)}\\`) || resolve(path).startsWith(`${resolve(root)}/`);
}

function readTarget(argv) {
  const triple = valueFor(argv, '--target');
  if (triple === undefined) throw new Error('--target requires a Rust target triple');
  return resolveTarget(triple);
}

function valueFor(argv, name) {
  const index = argv.indexOf(name);
  if (index < 0) return undefined;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('-')) throw new Error(`${name} requires a value`);
  return value;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function defaultPublicKey() {
  if (typeof DEFAULT_UPDATER_PUBLIC_KEY !== 'string') {
    throw new Error('desktop updater public key is missing');
  }
  return DEFAULT_UPDATER_PUBLIC_KEY;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const fixture = await loadFixture({ ...options });
  const served = await serveUpdateFixture({ fixture, host: options.host, port: options.port });
  console.log(`[update-fixture] target: ${options.target.productTarget}`);
  console.log(`[update-fixture] version: ${options.version}`);
  console.log(`[update-fixture] manifest: ${served.url}`);
  console.log('[update-fixture] keep this process running while the installed N version checks for an update');
  await new Promise((resolveExit) => {
    const close = () => { served.server.close(() => resolveExit()); };
    process.once('SIGINT', close);
    process.once('SIGTERM', close);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`[update-fixture] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
