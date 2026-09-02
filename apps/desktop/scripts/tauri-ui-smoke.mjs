// Drive one installed Linux desktop package through WebKitWebDriver. The
// session fixture is a committed keyless transcript, so this check observes
// the native Tauri WebView while keeping model traffic out of CI.
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { resolveTargetFromArgs } from './target-spec.mjs';
import { runCommand as run } from './run-command.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(here, '../../..');
const defaultFixture = resolve(repositoryRoot, 'snapshots/web/navigation-panes/session.jsonl');
const sensitiveEnvironmentName = /(KEY|SECRET|TOKEN|PASSWORD)/i;
const driverOutputLimit = 64 * 1024;

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
 * Turn a recorded Web fixture into one directly readable persistence log.
 * Web tests rebuild the header before seeding; the installed-package smoke
 * must supply the same required metadata when it writes the fixture itself.
 *
 * @param {string} fixtureText Recorded session fixture.
 * @param {string} workspace Temporary workspace root.
 * @param {string} sessionId Stable smoke session id.
 * @returns {string} Plaintext JSONL with a current persisted-session header.
 */
export function realizePersistedFixture(fixtureText, workspace, sessionId) {
  const lines = fixtureText.split('\n');
  const recordedHeader = JSON.parse(lines.shift() ?? 'null');
  if (recordedHeader?.type !== 'session'
    || !Number.isSafeInteger(recordedHeader.version)
    || !Number.isSafeInteger(recordedHeader.createdAt)) {
    throw new Error('native UI fixture must start with a versioned session header');
  }
  const persistedHeader = {
    type: 'session',
    version: recordedHeader.version,
    id: sessionId,
    createdAt: recordedHeader.createdAt,
    cwd: join(workspace, 'workspace'),
    delegationDepth: 0,
    agentPreset: 'standard',
  };
  const escapedSessionId = JSON.stringify(sessionId).slice(1, -1);
  const escapedWorkspace = JSON.stringify(workspace).slice(1, -1);
  // Projected web fixtures omit event envelopes; the JSONL backend requires
  // contiguous seq (and integer time) on every committed event, so synthesize
  // them here exactly as llm-replay's parseSessionLog does: packed chunk rows
  // take seq0/time0, ordinary events take seq/time, and nextSeq advances by
  // the decoded member count so packed rows cannot break contiguity.
  let nextSeq = 0;
  const rows = lines.map((line) => {
    if (line.trim().length === 0) return line;
    const record = JSON.parse(line);
    const packed = record.type === 'text-chunks' || record.type === 'reasoning-chunks' || record.type === 'tool-call-chunks';
    const seqKey = packed ? 'seq0' : 'seq';
    const timeKey = packed ? 'time0' : 'time';
    if (!Object.hasOwn(record, seqKey)) record[seqKey] = nextSeq;
    if (!Object.hasOwn(record, timeKey)) record[timeKey] = 0;
    nextSeq += packed ? record.data.texts?.length ?? record.data.args?.length ?? 1 : 1;
    return JSON.stringify(record);
  });
  const events = rows.join('\n')
    .split('{{sessionId}}').join(escapedSessionId)
    .split('{{cwd}}').join(escapedWorkspace);
  return `${JSON.stringify(persistedHeader)}\n${events}`;
}

/**
 * Materialize a committed session fixture in the runtime's plaintext JSONL
 * mode. The temporary home patch selects the same compression explicitly;
 * this keeps the fixture writer independent of private Zstandard APIs.
 *
 * @param {string} home Temporary DSH_HOME.
 * @param {string} fixturePath Committed session fixture.
 * @returns {{workspace: string, sessionId: string, sessionPath: string, patchPath: string}}
 */
export function materializeFixture(home, fixturePath) {
  const workspace = join(home, 'workspace');
  const sessionId = 'dsh-desktop-native-ui';
  const patchPath = join(home, 'cordis.patch.yml');
  mkdirSync(join(workspace, 'workspace'), { recursive: true });
  writeFileSync(join(workspace, 'workspace', 'nav-a.md'), '# alpha nav\n');
  writeFileSync(join(workspace, 'workspace', 'nav-b.md'), '# beta nav\n');
  writeFileSync(patchPath, [
    '- id: session-persistence-jsonl',
    '  config:',
    `    root: ${JSON.stringify(join(home, 'sessions'))}`,
    '    compression: none',
    '',
  ].join('\n'), { encoding: 'utf8' });

  const contents = realizePersistedFixture(readFileSync(fixturePath, 'utf8'), workspace, sessionId);
  const sessionPath = join(
    home,
    'sessions',
    projectKey(join(workspace, 'workspace')),
    encodeSegment(sessionId),
    'session.jsonl',
  );
  mkdirSync(dirname(sessionPath), { recursive: true });
  writeFileSync(sessionPath, contents, { encoding: 'utf8' });
  return { workspace, sessionId, sessionPath, patchPath };
}

/**
 * Build the environment inherited by tauri-driver and the installed app.
 *
 * @param {string} home Temporary DSH_HOME.
 * @param {string} patchPath Plaintext fixture persistence overlay.
 * @param {NodeJS.ProcessEnv} [environment] Ambient runner environment.
 * @returns {NodeJS.ProcessEnv} Environment that makes the shell pass the fixture overlay to dsh.
 */
export function nativeUiDriverEnvironment(home, patchPath, environment = process.env) {
  const inherited = Object.fromEntries(
    Object.entries(environment).filter(([name]) => !sensitiveEnvironmentName.test(name)),
  );
  return {
    ...inherited,
    DSH_HOME: home,
    DSH_PATCH: patchPath,
    DSH_TELEMETRY_DISABLED: '1',
    TMPDIR: home,
    WEBKIT_DISABLE_DMABUF_RENDERER: '1',
  };
}

/**
 * Remove the per-boot loopback credential from retained native diagnostics.
 *
 * @param {string} output Driver and installed-process output.
 * @returns {string} Diagnostic text safe to print in CI.
 */
export function redactNativeUiDiagnostics(output) {
  return output
    .replace(/([?&]dsh_token=)[^&\s]+/gi, '$1<redacted>')
    .replace(/(DSH_WEB_TOKEN(?:=|:\s*))\S+/gi, '$1<redacted>');
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
 * Return the selector for the localized session tree.
 *
 * @returns {string} CSS selector for the English or Chinese Sessions tree.
 */
export function seededSessionTreeSelector() {
  return '[role="tree"][aria-label="Sessions"], [role="tree"][aria-label="会话"]';
}

/**
 * Return the selector for persisted session rows in the main session tree.
 *
 * @returns {string} CSS selector for selectable session rows.
 */
export function seededSessionRowSelector() {
  return '[role="treeitem"][aria-selected]';
}

/**
 * Return the selector for collapsible groups in the main session tree.
 *
 * @returns {string} CSS selector for Workspace and Ungrouped rows.
 */
export function seededSessionGroupSelector() {
  return '[role="treeitem"][aria-expanded]';
}

/**
 * Acknowledge the product notice that appears for a fresh DSH_HOME.
 *
 * @param {{querySelectorAll(selector: string): Iterable<{textContent?: string, disabled?: boolean, click(): void}>}} documentRoot DOM-like root.
 * @returns {{present: boolean, disabled: boolean, clicked: boolean}} Notice state after this attempt.
 */
export function advanceWelcomeNotice(documentRoot) {
  const button = Array.from(documentRoot.querySelectorAll('button')).find((candidate) => {
    const label = candidate.textContent?.trim();
    return label === 'Continue' || label === '继续';
  });
  if (button === undefined) return { present: false, disabled: false, clicked: false };
  const disabled = button.disabled === true;
  if (!disabled) button.click();
  return { present: true, disabled, clicked: !disabled };
}

/**
 * Defer credential configuration in the second fresh-home onboarding step.
 *
 * @param {{querySelectorAll(selector: string): Iterable<{textContent?: string, disabled?: boolean, click(): void}>}} documentRoot DOM-like root.
 * @returns {{present: boolean, disabled: boolean, clicked: boolean}} Credential-step state after this attempt.
 */
export function advanceApiKeyOnboarding(documentRoot) {
  const button = Array.from(documentRoot.querySelectorAll('button')).find((candidate) => {
    const label = candidate.textContent?.trim();
    return label === 'Configure later' || label === '稍后配置';
  });
  if (button === undefined) return { present: false, disabled: false, clicked: false };
  const disabled = button.disabled === true;
  if (!disabled) button.click();
  return { present: true, disabled, clicked: !disabled };
}

/**
 * Advance navigation through a collapsed single-group session tree.
 *
 * @param {{querySelectorAll: (selector: string) => ArrayLike<{querySelectorAll: (selector: string) => ArrayLike<{click: () => void, textContent?: string | null, getAttribute: (name: string) => string | null, querySelector: (selector: string) => unknown}>}>}} documentRoot Browser document or a test double.
 * @param {string} treeSelector Localized Sessions tree.
 * @param {string} rowSelector Selectable persisted session rows.
 * @param {string} groupSelector Collapsible session groups.
 * @returns {{treeCount: number, count: number, labels: string[], persistedCount: number, groupCount: number, groupLabels: string[], expanded: boolean, clicked: boolean}} Navigation observation.
 */
export function advanceSeededSessionNavigation(documentRoot, treeSelector, rowSelector, groupSelector) {
  const trees = [...documentRoot.querySelectorAll(treeSelector)];
  const rows = trees.flatMap(tree => [...tree.querySelectorAll(rowSelector)]);
  const groups = trees.flatMap(tree => [...tree.querySelectorAll(groupSelector)]);
  // A provisional blank row has no session-actions button; a nonblank persisted row does.
  const persistedRows = rows.filter(row => row.querySelector('button') !== null);
  let expanded = false;
  let clicked = false;
  if (persistedRows.length === 1) {
    persistedRows[0].click();
    clicked = true;
  } else if (persistedRows.length === 0
    && rows.length === 0
    && groups.length === 1
    && groups[0].getAttribute('aria-expanded') === 'false') {
    groups[0].click();
    expanded = true;
  }
  return {
    treeCount: trees.length,
    count: rows.length,
    labels: rows.map(node => node.textContent ?? ''),
    persistedCount: persistedRows.length,
    groupCount: groups.length,
    groupLabels: groups.map(node => node.textContent ?? ''),
    expanded,
    clicked,
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

async function captureScreenshot(port, sessionId, output) {
  const screenshot = await webdriverRequest(port, `/session/${sessionId}/screenshot`, 'GET');
  const encoded = screenshot.value?.value ?? screenshot.value;
  if (typeof encoded !== 'string') throw new Error('WebDriver screenshot response has no base64 payload');
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, Buffer.from(encoded, 'base64'));
}

async function selectMainWindow(port, sessionId) {
  const handlesResponse = await webdriverRequest(port, `/session/${sessionId}/window/handles`, 'GET');
  const handles = Array.isArray(handlesResponse.value) ? handlesResponse.value : [];
  for (const handle of handles) {
    try {
      await webdriverRequest(port, `/session/${sessionId}/window`, 'POST', { handle });
      const ready = await execute(port, sessionId, `
        return document.querySelector('[data-composer-seat]') !== null
          && document.querySelector('[data-composer-input]') !== null;
      `);
      if (ready === true) return true;
    } catch {
      // The splash window may close while the main window becomes visible.
    }
  }
  return false;
}

/**
 * Identify a WebDriver failure caused by a splash or WebView window closing.
 *
 * @param {unknown} error WebDriver request failure.
 * @returns {boolean} Whether another window enumeration can recover the request.
 */
export function isClosedWindowError(error) {
  return error instanceof Error && error.message.includes('"error":"no such window"');
}

async function waitForUi(port, sessionId) {
  const deadline = Date.now() + 120_000;
  let lastState = undefined;
  while (Date.now() < deadline) {
    const selected = await selectMainWindow(port, sessionId);
    if (!selected) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 250));
      continue;
    }
    try {
      lastState = await execute(port, sessionId, `
        const body = document.body?.innerText ?? '';
        return {
          ready: document.querySelector('[data-composer-seat]') !== null
            && document.querySelector('[data-composer-input]') !== null,
          body,
        };
      `);
    } catch (error) {
      if (!isClosedWindowError(error)) throw error;
      await new Promise((resolveWait) => setTimeout(resolveWait, 250));
      continue;
    }
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

async function dismissWelcomeNotice(port, sessionId) {
  const deadline = Date.now() + 30_000;
  let lastState;
  while (Date.now() < deadline) {
    lastState = await execute(port, sessionId, `
      return (${advanceWelcomeNotice.toString()})(document);
    `);
    if (lastState?.present === false) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(`native Tauri UI could not acknowledge the testing notice: ${JSON.stringify(lastState)}`);
}

async function dismissApiKeyOnboarding(port, sessionId) {
  const deadline = Date.now() + 30_000;
  let deferred = false;
  let absentObservations = 0;
  let lastState;
  while (Date.now() < deadline) {
    lastState = await execute(port, sessionId, `
      return (${advanceApiKeyOnboarding.toString()})(document);
    `);
    if (lastState?.clicked === true) deferred = true;
    if (lastState?.present === false) {
      absentObservations += 1;
      if (deferred || absentObservations >= 8) return;
    } else {
      absentObservations = 0;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(`native Tauri UI could not defer API key onboarding: ${JSON.stringify(lastState)}`);
}

async function openSeededSession(port, sessionId) {
  const treeSelector = seededSessionTreeSelector();
  const rowSelector = seededSessionRowSelector();
  const groupSelector = seededSessionGroupSelector();
  const deadline = Date.now() + 30_000;
  let lastState;
  while (Date.now() < deadline) {
    lastState = await execute(port, sessionId, `
      return (${advanceSeededSessionNavigation.toString()})(document, arguments[0], arguments[1], arguments[2]);
    `, [treeSelector, rowSelector, groupSelector]);
    if (lastState?.clicked) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(`native Tauri UI could not open the seeded navigation session: ${JSON.stringify(lastState)}`);
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
  let driverOutput = '';
  let failure;
  let installed = false;
  try {
    const fixture = materializeFixture(home, options.fixture);
    run('sudo', ['dpkg', '--install', options.artifact], { stdio: 'inherit' });
    installed = true;
    const executable = installedExecutable(packageName);
    driver = spawn('tauri-driver', ['--port', String(options.port)], {
      env: nativeUiDriverEnvironment(home, fixture.patchPath),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const appendDriverOutput = (chunk) => {
      driverOutput = `${driverOutput}${String(chunk)}`.slice(-driverOutputLimit);
    };
    driver.stdout?.on('data', appendDriverOutput);
    driver.stderr?.on('data', appendDriverOutput);
    await waitForPort(options.port, driver);
    const session = await webdriverRequest(options.port, '/session', 'POST', webdriverCapabilities(executable));
    sessionId = session.value?.sessionId ?? session.sessionId;
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
      throw new Error(`WebDriver did not return a session id: ${JSON.stringify(session)}`);
    }
    const initial = await waitForUi(options.port, sessionId);
    await dismissWelcomeNotice(options.port, sessionId);
    await dismissApiKeyOnboarding(options.port, sessionId);
    await openSeededSession(options.port, sessionId);
    const terminal = await assertTerminalCard(options.port, sessionId);
    if (options.screenshot !== undefined) {
      await captureScreenshot(options.port, sessionId, options.screenshot);
    }
    console.log(`[tauri-ui-smoke] ready=${initial.ready} terminal=${terminal.output}`);
    if (driverOutput.includes('error')) console.error(`[tauri-ui-smoke] driver output: ${driverOutput}`);
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    if (typeof sessionId === 'string' && options.screenshot !== undefined && !existsSync(options.screenshot)) {
      try {
        await captureScreenshot(options.port, sessionId, options.screenshot);
      } catch (error) {
        console.error(`[tauri-ui-smoke] could not capture failure screenshot: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (typeof sessionId === 'string') {
      await webdriverRequest(options.port, `/session/${sessionId}`, 'DELETE').catch(() => {});
    }
    if (driver !== undefined) {
      const stopped = await terminateProcess(driver);
      if (!stopped) driverCleanupError = new Error('tauri-driver did not exit after SIGTERM and SIGKILL');
    }
    if (failure !== undefined) {
      const splashLog = join(home, 'dsh-desktop-splash.log');
      if (driverOutput.trim().length > 0) {
        console.error(`[tauri-ui-smoke] driver output:\n${redactNativeUiDiagnostics(driverOutput.trim())}`);
      }
      if (existsSync(splashLog)) {
        const contents = redactNativeUiDiagnostics(readFileSync(splashLog, 'utf8').trim());
        console.error(`[tauri-ui-smoke] native splash log:\n${contents}`);
      }
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
