// Assemble the smallest real web composition needed for desktop GUI evidence.
// The command owns a throwaway DSH_HOME, installs the built bridge packages
// into the profile fallback, creates one Workspace through the real RPC route,
// and keeps the same dsh web process alive for a browser recorder.
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(here, '..');
const repoRoot = resolve(desktopRoot, '../..');
const cli = resolve(repoRoot, 'apps/cli/lib/bin.js');
const bridgeSources = [
  resolve(desktopRoot, 'bridge'),
  resolve(desktopRoot, 'bridge-client'),
];
const defaultPort = 4173;
const maxOutputBytes = 8 * 1024 * 1024;
const readinessTimeoutMs = 120_000;

/**
 * Authorization header for the loopback bearer token, when the runtime was
 * started with DSH_WEB_TOKEN (the desktop shell does per boot). Without the
 * token the headers stay empty and the plain loopback posture is unchanged.
 * @returns header record to spread onto requests.
 */
function authHeaders() {
  const token = process.env.DSH_WEB_TOKEN;
  return token === undefined || token.length === 0 ? {} : { authorization: `Bearer ${token}` };
}

/**
 * Parse the evidence server's command-line options.
 * @param {readonly string[]} args - Arguments after the script name.
 * @returns {{ port: number, workspace: string, keepHome: boolean }} options.
 */
export function parseArguments(args) {
  let port = defaultPort;
  let workspace = repoRoot;
  let keepHome = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--') continue;
    if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    }
    if (arg === '--keep-home') {
      keepHome = true;
      continue;
    }
    if (arg === '--port' || arg === '--workspace') {
      const value = args[++index];
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`${arg} requires a value`);
      }
      if (arg === '--workspace') {
        workspace = resolve(value);
      } else {
        port = Number(value);
        if (!Number.isInteger(port) || port < 0 || port > 65535) {
          throw new Error(`--port must be an integer from 0 to 65535; received ${value}`);
        }
      }
      continue;
    }
    throw new Error(`unknown option ${arg}`);
  }
  return { port, workspace, keepHome };
}

/**
 * Merge bridge rows into a profile patch without duplicating an existing install.
 * @param {string} existing - Current profile patch contents.
 * @param {string} bridgePatch - Bridge package patch contents.
 * @returns {string} The merged YAML text with one trailing newline.
 */
export function mergeProfilePatch(existing, bridgePatch) {
  if (existing.includes('id: desktop-bridge')) return ensureTrailingNewline(existing);
  const source = ensureTrailingNewline(bridgePatch);
  const emptyList = /^(\s*)\[\]\s*$/m;
  if (emptyList.test(existing)) return ensureTrailingNewline(existing.replace(emptyList, source.trimEnd()));
  const separator = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
  return `${existing}${separator}${source}`;
}

/**
 * Copy one built standalone package into a profile module directory.
 * @param {string} source - Package source directory.
 * @param {string} targetRoot - `node_modules/@deepseek-ai` directory.
 */
export function installPackage(source, targetRoot) {
  const manifestPath = join(source, 'package.json');
  if (!existsSync(manifestPath)) throw new Error(`package manifest missing: ${manifestPath}`);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const name = manifest.name;
  const packageName = typeof name === 'string' && name.startsWith('@deepseek-ai/')
    ? name.slice('@deepseek-ai/'.length)
    : undefined;
  if (packageName === undefined || packageName.length === 0 || packageName.includes('/')) {
    throw new Error(`package name must be a single @deepseek-ai package: ${manifestPath}`);
  }
  const target = join(targetRoot, packageName);
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, 'package.json'), readFileSync(manifestPath));
  const files = Array.isArray(manifest.files) ? manifest.files : ['lib'];
  for (const entry of files) {
    const from = resolve(source, entry);
    if (existsSync(from)) copyRecursive(from, join(target, entry));
  }
}

/**
 * Check the installation-owned fallback entry before the evidence script may replace it.
 * @param {string} path - Fallback package path.
 */
export function assertReplaceableFallbackEntry(path) {
  try {
    if (!lstatSync(path).isSymbolicLink()) {
      throw new Error(`profile fallback ${path} is not a symlink; evidence setup will not replace it`);
    }
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
}

/**
 * Extract the browser session cookie minted by the startup URL exchange.
 * @param {Response} response - Manual-redirect response from the web root.
 * @returns {string | undefined} Cookie header value, when the exchange minted one.
 */
export function sessionCookieFromResponse(response) {
  const setCookies = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter((value) => value !== null);
  const cookie = setCookies.find((value) => value.startsWith('dsh-auth-'));
  return cookie?.split(';', 1)[0];
}

/**
 * Start the real dsh web profile and wait for its readiness line.
 * @param {string} home - Scratch DSH_HOME.
 * @param {number} port - Fixed HTTP port.
 * @returns {Promise<{ child: import('node:child_process').ChildProcessWithoutNullStreams, url: string, output: string[] }>}
 */
export function startServer(home, port) {
  return new Promise((resolveReady, reject) => {
    const env = { ...process.env, DSH_HOME: home };
    delete env.DSH_BARE_MODULE_BASE;
    const child = spawn(process.execPath, [cli, 'web', '--port', String(port), '--no-open'], {
      cwd: repoRoot,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const output = [];
    let settled = false;
    let byteCount = 0;
    const timeout = setTimeout(() => {
      child.kill();
      fail(new Error(`dsh web did not print a readiness URL within ${readinessTimeoutMs}ms\n${output.join('')}`));
    }, readinessTimeoutMs);
    const append = (chunk) => {
      if (byteCount >= maxOutputBytes) return;
      const text = String(chunk);
      byteCount += Buffer.byteLength(text);
      output.push(text);
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    };
    const ready = (chunk) => {
      append(chunk);
      const match = String(chunk).match(/dsh web: (https?:\/\/[^\s\r\n]+)/);
      if (match === null || settled) return;
      settled = true;
      clearTimeout(timeout);
      resolveReady({ child, url: match[1], output });
    };
    child.stdout.on('data', ready);
    child.stderr.on('data', append);
    child.on('error', fail);
    child.on('exit', (code, signal) => {
      if (!settled) fail(new Error(`dsh web exited before readiness (code=${code}, signal=${signal})\n${output.join('')}`));
    });
  });
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  assertPrerequisites();
  if (!statSync(options.workspace).isDirectory()) throw new Error(`Workspace is not a directory: ${options.workspace}`);

  const home = mkdtempSync(join(tmpdir(), 'dsh-desktop-evidence-'));
  let server;
  let shuttingDown = false;
  const stop = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (server?.child.exitCode === null) server.child.kill();
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    await runOnce(process.execPath, [cli, '--profile', 'web', '--dump-default-config'], { DSH_HOME: home });
    const profileDir = resolve(home, 'profiles/web');
    const fallbackModules = resolve(home, 'profiles/node_modules/@deepseek-ai');
    const schemastery = join(fallbackModules, 'schemastery');
    assertReplaceableFallbackEntry(schemastery);
    for (const source of bridgeSources) installPackage(source, fallbackModules);
    const patchPath = join(profileDir, 'cordis.patch.yml');
    const bridgePatch = readFileSync(join(bridgeSources[0], 'cordis.patch.yml'), 'utf8');
    writeFileSync(patchPath, mergeProfilePatch(readFileSync(patchPath, 'utf8'), bridgePatch));

    server = await startServer(home, options.port);
    const baseUrl = new URL(server.url);
    const sessionCookie = await authenticateServer(baseUrl);
    const workspace = await createWorkspace(baseUrl, options.workspace, sessionCookie);
    const configUrl = new URL('/dsh-bridge/config', baseUrl);
    const configResponse = await fetch(configUrl, { headers: { ...authHeaders(), cookie: sessionCookie } });
    if (!configResponse.ok) throw new Error(`bridge config returned HTTP ${configResponse.status}`);
    const config = await configResponse.json();
    if (typeof config !== 'object' || config === null) throw new Error('bridge config did not return a JSON object');

    console.log(`[dsh evidence] home: ${home}`);
    console.log(`[dsh evidence] workspace: ${workspace.workspace.workspaceId} (${options.workspace})`);
    console.log(`[dsh evidence] ready: ${baseUrl.href}`);
    console.log(`[dsh evidence] config: ${configUrl.href}`);
    console.log('[dsh evidence] open the ready URL in a browser and select Worktree in the sidebar. Press Ctrl+C to stop.');
    await new Promise((resolveExit) => server.child.once('exit', resolveExit));
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    if (server?.child.exitCode === null) server.child.kill();
    if (!options.keepHome) rmSync(home, { recursive: true, force: true });
    else console.log(`[dsh evidence] kept home: ${home}`);
  }
}

function assertPrerequisites() {
  if (!existsSync(cli)) throw new Error(`dsh CLI not built: expected ${cli}; run pnpm run build:lib`);
  for (const source of bridgeSources) {
    if (!existsSync(join(source, 'lib/index.js'))) {
      throw new Error(`desktop bridge not built: expected ${join(source, 'lib/index.js')}; run pnpm --filter @deepseek-ai/dsh-desktop evidence`);
    }
  }
}

async function runOnce(command, args, extraEnv) {
  await new Promise((resolveRun, rejectRun) => {
    const env = { ...process.env, ...extraEnv };
    delete env.DSH_BARE_MODULE_BASE;
    const child = spawn(command, args, {
      cwd: repoRoot,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let output = '';
    const append = (chunk) => {
      if (Buffer.byteLength(output) < maxOutputBytes) output += String(chunk);
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    child.on('error', rejectRun);
    child.on('exit', (code, signal) => {
      if (code === 0) resolveRun();
      else rejectRun(new Error(`profile initialization failed (code=${code}, signal=${signal})\n${output}`));
    });
  });
}

async function authenticateServer(baseUrl) {
  const response = await fetch(baseUrl, { headers: authHeaders(), redirect: 'manual' });
  if (response.status !== 303) {
    throw new Error(`web startup authentication returned HTTP ${response.status}`);
  }
  const cookie = sessionCookieFromResponse(response);
  if (cookie === undefined) throw new Error('web startup authentication did not return a session cookie');
  return cookie;
}

async function createWorkspace(baseUrl, path, sessionCookie) {
  const rpcId = randomUUID();
  const response = await fetch(new URL('/api/workspace/create', baseUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders(), cookie: sessionCookie },
    body: JSON.stringify({
      type: 'client-request',
      rpcId,
      method: 'workspace/create',
      payload: { args: { request: { path } } },
    }),
  });
  if (!response.ok) throw new Error(`workspace registration returned HTTP ${response.status}: ${await response.text()}`);
  const body = await response.json();
  if (body?.rpcId !== rpcId || body?.result?.ok !== true) {
    throw new Error(`workspace registration failed: ${JSON.stringify(body)}`);
  }
  return body.result.value;
}

function copyRecursive(source, target) {
  const info = statSync(source);
  if (info.isDirectory()) {
    mkdirSync(target, { recursive: true });
    for (const entry of readdirSync(source)) copyRecursive(join(source, entry), join(target, entry));
    return;
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, readFileSync(source));
}

function ensureTrailingNewline(value) {
  return value.endsWith('\n') ? value : `${value}\n`;
}

function printUsage() {
  console.log('Usage: pnpm --filter @deepseek-ai/dsh-desktop evidence [-- --port 4173 --workspace <dir> --keep-home]');
}

if (pathToFileURL(resolve(process.argv[1] ?? '')).href === import.meta.url) {
  main().catch((error) => {
    console.error(`[dsh evidence] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
