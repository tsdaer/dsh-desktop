// Drive one installed Linux desktop package through WebKitWebDriver. The
// session fixture is a committed keyless transcript, so this check observes
// the native Tauri WebView while keeping model traffic out of CI.
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { resolveTargetFromArgs } from './target-spec.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(here, '../../..');
const defaultFixture = resolve(repositoryRoot, 'apps/web/tests/snapshots/navigation-panes/seed.jsonl');

/**
 * Parse the Linux native WebView smoke options.
 *
 * @param {readonly string[]} argv Arguments after the script name.
 * @returns {{target: Readonly<object>, artifact: string, fixture: string, screenshot?: string, port: number, home?: string}}
 */
export function parseArguments(argv) {
  const target = resolveTargetFromArgs(argv);
  if (target.productTarget !== 'linux-x64') {
    throw new Error(`native Tauri UI smoke currently supports Linux x64 only: ${target.rustTriple}`);
  }
  const artifact = requiredValue(argv, '--artifact');
  if (!artifact.endsWith('.deb')) throw new Error('native Tauri UI smoke requires a deb artifact');
  const fixture = resolve(valueFor(argv, '--fixture') ?? defaultFixture);
  const screenshotValue = valueFor(argv, '--screenshot');
  const portValue = valueFor(argv, '--port') ?? '4444';
  const port = Number(portValue);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('--port must be an integer from 1 to 65535');
  }
  return {
    target,
    artifact: resolve(artifact),
    fixture,
    ...(screenshotValue === undefined ? {} : { screenshot: resolve(screenshotValue) }),
    port,
    ...(valueFor(argv, '--home') === undefined ? {} : { home: resolve(valueFor(argv, '--home')) }),
  };
}

/**
 * Encode a path segment using the JSONL persistence backend's safe alphabet.
 *
 * @param {string} raw Segment to encode.
 * @returns {string} Filesystem-safe segment.
 */
export function encodeSegment(raw) {
  if (raw.length === 0) throw new Error('cannot encode an empty path segment');
  if (raw === '.') return '~002E';
  if (raw === '..') return '~002E~002E';
  let result = '';
  for (let index = 0; index < raw.length; index += 1) {
    const code = raw.charCodeAt(index);
    const character = String.fromCharCode(code);
    result += character !== '~' && /^[A-Za-z0-9._-]$/.test(character)
      ? character
      : `~${code.toString(16).toUpperCase().padStart(4, '0')}`;
  }
  return result;
}

/**
 * Build the JSONL persistence project directory for one session cwd.
 *
 * @param {string} cwd Session working directory.
 * @returns {string} Human-readable project key.
 */
export function projectKey(cwd) {
  let readable = '';
  let separatorRun = false;
  for (let index = 0; index < cwd.length; index += 1) {
    const code = cwd.charCodeAt(index);
    const character = String.fromCharCode(code);
    if (character === '/' || character === '\\' || character === ':') {
      if (!separatorRun) readable += '-';
      separatorRun = true;
    } else if (character !== '~' && /^[A-Za-z0-9._-]$/.test(character)) {
      readable += character;
      separatorRun = false;
    } else {
      readable += `~${code.toString(16).toUpperCase().padStart(4, '0')}`;
      separatorRun = false;
    }
  }
  return `--${(readable.replace(/^-+/, '') || 'root').slice(0, 251)}--`;
}

/**
 * Materialize a committed session fixture in the runtime's plaintext JSONL
 * mode. The temporary home patch selects the same compression explicitly;
 * this keeps the fixture writer independent of private Zstandard APIs.
 *
 * @param {string} home Temporary DSH_HOME.
 * @param {string} fixturePath Committed session fixture.
 * @returns {{workspace: string, sessionId: string, sessionPath: string}}
 */
export function materializeFixture(home, fixturePath) {
  const workspace = join(home, 'workspace');
  const sessionId = 'dsh-desktop-native-ui';
  mkdirSync(join(workspace, 'workspace'), { recursive: true });
  writeFileSync(join(workspace, 'workspace', 'nav-a.md'), '# alpha nav\n');
  writeFileSync(join(workspace, 'workspace', 'nav-b.md'), '# beta nav\n');
  writeFileSync(join(home, 'cordis.patch.yml'), [
    '- id: session-persistence-jsonl',
    '  config:',
    `    root: ${JSON.stringify(join(home, 'sessions'))}`,
    '    compression: none',
    '',
  ].join('\n'), { encoding: 'utf8' });

  const contents = readFileSync(fixturePath, 'utf8')
    .split('{{sessionId}}').join(sessionId)
    .split('{{cwd}}').join(workspace);
  const sessionPath = join(
    home,
    'sessions',
    projectKey(join(workspace, 'workspace')),
    encodeSegment(sessionId),
    'session.jsonl',
  );
  mkdirSync(dirname(sessionPath), { recursive: true });
  writeFileSync(sessionPath, contents, { encoding: 'utf8' });
  return { workspace, sessionId, sessionPath };
}

/**
 * Return the WebDriver capabilities required by tauri-driver.
 *
 * @param {string} executable Installed desktop executable.
 * @returns {Readonly<object>} W3C capabilities.
 */
export function webdriverCapabilities(executable) {
  return {
    capabilities: {
      alwaysMatch: {
        'tauri:options': { application: executable },
      },
    },
  };
}

/**
 * Terminate a child process without waiting for an exit event that may already
 * have fired, and bound cleanup when graceful termination is ignored.
 *
 * @param {import('node:child_process').ChildProcess} child Process to stop.
 * @param {{graceMs?: number, forceMs?: number}} [options] Cleanup deadlines.
 * @returns {Promise<boolean>} Whether the child reported exit before the final deadline.
 */
export function terminateProcess(child, { graceMs = 5_000, forceMs = 1_000 } = {}) {
  const hasExited = () => child.exitCode !== null || child.signalCode !== null;
  if (hasExited()) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    let graceTimer;
    let forceTimer;
    const finish = (stopped) => {
      if (settled) return;
      settled = true;
      if (graceTimer !== undefined) clearTimeout(graceTimer);
      if (forceTimer !== undefined) clearTimeout(forceTimer);
      child.removeListener('exit', onExit);
      resolve(stopped);
    };
    const onExit = () => finish(true);
    child.once('exit', onExit);
    if (hasExited()) {
      finish(true);
      return;
    }
    child.kill('SIGTERM');
    if (settled) return;
    graceTimer = setTimeout(() => {
      if (hasExited()) {
        finish(true);
        return;
      }
      child.kill('SIGKILL');
      if (settled) return;
      forceTimer = setTimeout(() => {
        const stopped = hasExited();
        if (!stopped) {
          child.stdout?.destroy();
          child.stderr?.destroy();
          child.unref?.();
        }
        finish(stopped);
      }, forceMs);
    }, graceMs);
  });
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

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}\n${result.stderr || result.stdout}`);
  }
  return (result.stdout ?? '').trim();
}

function installedPackageName(artifact) {
  return run('dpkg-deb', ['--field', artifact, 'Package']);
}

function installedExecutable(packageName) {
  const files = run('dpkg-query', ['-L', packageName]).split(/\r?\n/).filter(Boolean);
  const executable = files.find((file) => file.endsWith('/bin/dsh-desktop'));
  if (executable === undefined || !existsSync(executable)) {
    throw new Error(`installed package ${packageName} has no executable at /bin/dsh-desktop`);
  }
  return executable;
}

async function waitForPort(port, child) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`tauri-driver exited before listening (code=${child.exitCode})`);
    const open = await new Promise((resolveOpen) => {
      const socket = createConnection({ host: '127.0.0.1', port });
      socket.once('connect', () => { socket.destroy(); resolveOpen(true); });
      socket.once('error', () => resolveOpen(false));
    });
    if (open) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`tauri-driver did not listen on port ${port}`);
}

async function webdriverRequest(port, path, method, body) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let payload;
  try { payload = text.length === 0 ? {} : JSON.parse(text); } catch { payload = { value: { message: text } }; }
  if (!response.ok || payload.value?.error !== undefined) {
    throw new Error(`WebDriver ${method} ${path} failed: ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function execute(port, sessionId, script, args = []) {
  const response = await webdriverRequest(port, `/session/${sessionId}/execute/sync`, 'POST', { script, args });
  return response.value;
}

async function selectMainWindow(port, sessionId) {
  const handlesResponse = await webdriverRequest(port, `/session/${sessionId}/window/handles`, 'GET');
  const handles = Array.isArray(handlesResponse.value) ? handlesResponse.value : [];
  for (const handle of handles) {
    try {
      await webdriverRequest(port, `/session/${sessionId}/window`, 'POST', { handle });
      const ready = await execute(port, sessionId, `
        return document.querySelector('[data-composer-seat]') !== null
          && document.querySelector('textarea') !== null;
      `);
      if (ready === true) return;
    } catch {
      // The splash window may close while the main window becomes visible.
    }
  }
}

async function waitForUi(port, sessionId) {
  const deadline = Date.now() + 120_000;
  let lastState = undefined;
  while (Date.now() < deadline) {
    await selectMainWindow(port, sessionId);
    lastState = await execute(port, sessionId, `
      const body = document.body?.innerText ?? '';
      return {
        ready: document.querySelector('[data-composer-seat]') !== null
          && document.querySelector('textarea') !== null,
        body,
      };
    `);
    if (lastState?.ready) return lastState;
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(`native Tauri UI did not reach the seeded composer state: ${JSON.stringify(lastState)}`);
}

async function click(port, sessionId, selector) {
  const clicked = await execute(port, sessionId, `
    const node = document.querySelector(${JSON.stringify(selector)});
    if (node === null) return false;
    node.click();
    return true;
  `);
  if (clicked !== true) throw new Error(`native Tauri UI selector did not match: ${selector}`);
}

async function openSeededSession(port, sessionId) {
  await execute(port, sessionId, `
    const button = document.querySelector('button[aria-label="Search sessions"]');
    if (button !== null && button.getAttribute('aria-expanded') !== 'true') button.click();
    return true;
  `);
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const found = await execute(port, sessionId, `
      const input = document.querySelector('input[placeholder*="Search sessions"]');
      if (input === null) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, 'WATERFALL');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const result = [...document.querySelectorAll('[role="treeitem"]')]
        .find((node) => (node.textContent ?? '').includes('WATERFALL'));
      if (result === undefined) return false;
      result.click();
      return true;
    `);
    if (found === true) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error('native Tauri UI could not open the seeded navigation session');
}

async function assertTerminalCard(port, sessionId) {
  const deadline = Date.now() + 30_000;
  let state;
  while (Date.now() < deadline) {
    state = await execute(port, sessionId, `
      const row = document.querySelector('[data-sample="bash"]');
      if (row !== null && row.getAttribute('aria-expanded') !== 'true') row.click();
      const card = document.querySelector('[data-terminal]');
      return {
        card: card !== null,
        output: card?.textContent?.includes('NAVIGATION_OK') === true,
      };
    `);
    if (state?.card && state?.output) return state;
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(`native Tauri UI terminal card did not settle: ${JSON.stringify(state)}`);
}

async function main() {
  if (process.platform !== 'linux') throw new Error('native Tauri UI smoke must run on Linux');
  const options = parseArguments(process.argv.slice(2));
  if (!existsSync(options.artifact) || statSync(options.artifact).size === 0) {
    throw new Error(`deb artifact is missing or empty: ${options.artifact}`);
  }
  if (!existsSync(options.fixture) || statSync(options.fixture).size === 0) {
    throw new Error(`session fixture is missing or empty: ${options.fixture}`);
  }
  const home = options.home ?? mkdtempSync(join(tmpdir(), 'dsh-desktop-native-ui-'));
  mkdirSync(home, { recursive: true });
  const marker = join(home, 'native-ui-user-data.marker');
  writeFileSync(marker, 'user-owned native UI smoke data\n', { encoding: 'utf8' });
  const packageName = installedPackageName(options.artifact);
  let driver;
  let sessionId;
  let driverCleanupError;
  let installed = false;
  try {
    materializeFixture(home, options.fixture);
    run('sudo', ['dpkg', '--install', options.artifact], { stdio: 'inherit' });
    installed = true;
    const executable = installedExecutable(packageName);
    driver = spawn('tauri-driver', ['--port', String(options.port)], {
      env: {
        ...process.env,
        DSH_HOME: home,
        DSH_TELEMETRY_DISABLED: '1',
        WEBKIT_DISABLE_DMABUF_RENDERER: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let driverOutput = '';
    driver.stdout?.on('data', (chunk) => { driverOutput += String(chunk); });
    driver.stderr?.on('data', (chunk) => { driverOutput += String(chunk); });
    await waitForPort(options.port, driver);
    const session = await webdriverRequest(options.port, '/session', 'POST', webdriverCapabilities(executable));
    sessionId = session.value?.sessionId ?? session.sessionId;
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
      throw new Error(`WebDriver did not return a session id: ${JSON.stringify(session)}`);
    }
    const initial = await waitForUi(options.port, sessionId);
    await openSeededSession(options.port, sessionId);
    const terminal = await assertTerminalCard(options.port, sessionId);
    if (options.screenshot !== undefined) {
      const screenshot = await webdriverRequest(options.port, `/session/${sessionId}/screenshot`, 'GET');
      const encoded = screenshot.value?.value ?? screenshot.value;
      if (typeof encoded !== 'string') throw new Error('WebDriver screenshot response has no base64 payload');
      mkdirSync(dirname(options.screenshot), { recursive: true });
      writeFileSync(options.screenshot, Buffer.from(encoded, 'base64'));
    }
    console.log(`[tauri-ui-smoke] ready=${initial.ready} terminal=${terminal.output}`);
    if (driverOutput.includes('error')) console.error(`[tauri-ui-smoke] driver output: ${driverOutput}`);
  } finally {
    if (typeof sessionId === 'string') {
      await webdriverRequest(options.port, `/session/${sessionId}`, 'DELETE').catch(() => {});
    }
    if (driver !== undefined) {
      const stopped = await terminateProcess(driver);
      if (!stopped) driverCleanupError = new Error('tauri-driver did not exit after SIGTERM and SIGKILL');
    }
    if (installed) run('sudo', ['dpkg', '--purge', packageName], { stdio: 'inherit' });
    if (!existsSync(marker) || statSync(marker).size === 0) {
      throw new Error('native UI smoke removed user data');
    }
    if (options.home === undefined) rmSync(home, { recursive: true, force: true });
    if (driverCleanupError !== undefined) throw driverCleanupError;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`[tauri-ui-smoke] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
