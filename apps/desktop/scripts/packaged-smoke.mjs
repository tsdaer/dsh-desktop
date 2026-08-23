// Launch a Linux or macOS package under a temporary DSH_HOME and verify the packaged
// shell reaches its runtime readiness line before the process tree is stopped.
// The smoke intentionally runs the installed entry point, not `cargo run` or
// the source CLI, so resource lookup and the target Node sidecar are included.
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, posix as posixPath, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

import { resolveTargetFromArgs } from './target-spec.mjs';

const requireWebDependency = createRequire(new URL('../../web/package.json', import.meta.url));

/**
 * Parse target-native packaged-smoke options.
 *
 * @param {readonly string[]} argv Arguments after the script name.
 * @returns {{target: Readonly<object>, artifact: string, installDeb: boolean, installDmg: boolean, installNsis: boolean, terminalSmoke: boolean, webSmoke: boolean, updateSmoke: boolean, expectedVersion?: string}}
 */
export function parseArguments(argv) {
  const target = resolveTargetFromArgs(argv);
  const artifactIndex = argv.indexOf('--artifact');
  const artifact = artifactIndex < 0 ? undefined : argv[artifactIndex + 1];
  if (!artifact || artifact.startsWith('-')) throw new Error('--artifact requires a package path');
  const installDeb = argv.includes('--install-deb');
  const installDmg = argv.includes('--install-dmg');
  const installNsis = argv.includes('--install-nsis');
  const terminalSmoke = argv.includes('--terminal-smoke');
  const webSmoke = argv.includes('--web-smoke');
  const updateSmoke = argv.includes('--update-smoke');
  const expectedVersionIndex = argv.indexOf('--expected-version');
  const expectedVersion = expectedVersionIndex < 0 ? undefined : argv[expectedVersionIndex + 1];
  if (expectedVersionIndex >= 0 && (!expectedVersion || expectedVersion.startsWith('-'))) {
    throw new Error('--expected-version requires a version');
  }
  if (updateSmoke && expectedVersion === undefined) {
    throw new Error('--update-smoke requires --expected-version');
  }
  if (!updateSmoke && expectedVersion !== undefined) {
    throw new Error('--expected-version requires --update-smoke');
  }
  if (expectedVersion !== undefined && !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(expectedVersion)) {
    throw new Error(`invalid expected update version: ${expectedVersion}`);
  }
  if ([installDeb, installDmg, installNsis].filter(Boolean).length > 1) {
    throw new Error('--install-deb, --install-dmg, and --install-nsis are mutually exclusive');
  }
  if (target.productTarget === 'windows-x64' && !installNsis) {
    throw new Error('Windows x64 packaged smoke requires --install-nsis');
  }
  if (target.productTarget !== 'windows-x64' && installNsis) {
    throw new Error('--install-nsis is only available for Windows x64');
  }
  if (target.productTarget === 'linux-x64' && installDmg) {
    throw new Error('--install-dmg is only available for macOS arm64');
  }
  if (target.productTarget === 'macos-arm64' && installDeb) {
    throw new Error('--install-deb is only available for Linux x64');
  }
  if (webSmoke && target.productTarget !== 'linux-x64') {
    throw new Error('--web-smoke is only available for Linux x64');
  }
  const expectedSuffix = target.productTarget === 'windows-x64'
    ? '.exe'
    : target.productTarget === 'linux-x64'
      ? (installDeb ? '.deb' : '.AppImage')
      : (installDmg ? '.dmg' : '.app');
  if (!artifact.endsWith(expectedSuffix)) {
    throw new Error(`expected a ${expectedSuffix} artifact: ${artifact}`);
  }
  return { target, artifact: resolve(artifact), installDeb, installDmg, installNsis, terminalSmoke, webSmoke, updateSmoke, expectedVersion };
}

/**
 * Observe one version marker during an installed update smoke.
 *
 * @param {boolean} sawInitialVersion Whether a non-expected version was already observed.
 * @param {string} observedVersion Version recorded by the current packaged launch.
 * @param {string} expectedVersion Version that the update must install.
 * @returns {{sawInitialVersion: boolean, complete: boolean}}
 */
export function observeUpdateVersion(sawInitialVersion, observedVersion, expectedVersion) {
  const observedInitialVersion = sawInitialVersion || observedVersion !== expectedVersion;
  return {
    sawInitialVersion: observedInitialVersion,
    complete: observedInitialVersion && observedVersion === expectedVersion,
  };
}

/**
 * Resolve the executable inside an unpacked package or app bundle.
 *
 * @param {string} root - Extracted package root or `.app` directory.
 * @param {{readonly productTarget: string}} target - Resolved desktop target.
 * @returns {string} Packaged shell executable path.
 */
export function packagedExecutable(root, target) {
  if (target.productTarget === 'windows-x64') return join(root, 'dsh-desktop.exe');
  if (target.productTarget === 'linux-x64') return join(root, 'AppRun');
  return join(root, 'Contents', 'MacOS', 'dsh-desktop');
}

/**
 * Return the target-specific command used to mount a macOS dmg.
 *
 * @param {string} artifact - Dmg path.
 * @param {string} mountPoint - Empty directory used as the mount point.
 * @returns {readonly string[]} hdiutil arguments.
 */
export function dmgMountArguments(artifact, mountPoint) {
  return ['attach', '-nobrowse', '-readonly', '-mountpoint', mountPoint, artifact];
}

/**
 * Return the macOS-native copy arguments used to install an app from a dmg.
 *
 * `ditto` preserves bundle metadata and resource forks that a generic
 * recursive filesystem copy can omit. Quarantine metadata belongs to the
 * downloaded dmg rather than the installed app created by this CI smoke.
 *
 * @param {string} app - App bundle mounted from the dmg.
 * @param {string} destination - Installed app bundle path.
 * @returns {readonly string[]} `ditto` arguments.
 */
export function dmgInstallArguments(app, destination) {
  return ['--noqtn', app, destination];
}

/**
 * Read the per-launch native splash log when packaged startup fails.
 *
 * @param {string} temporaryDirectory - Isolated native temp directory.
 * @returns {string} Diagnostic suffix, or an empty string when no log exists.
 */
export function splashLogDiagnostics(temporaryDirectory) {
  const path = join(temporaryDirectory, 'dsh-desktop-splash.log');
  if (!existsSync(path)) return '';
  return `\n[packaged-smoke] native splash log:\n${readFileSync(path, 'utf8')}`;
}

/**
 * Resolve a macOS app installation directory before launching from it.
 *
 * Tauri rejects executables with symlinked ancestors on macOS, while the
 * system temporary directory normally enters `/private/var` through `/var`.
 *
 * @param {string} temporaryDirectory - Existing temporary installation directory.
 * @returns {string} Symlink-free installation directory.
 */
export function macosInstallRoot(temporaryDirectory) {
  return realpathSync(temporaryDirectory);
}

/**
 * Keep the NSIS uninstaller in its installation directory so the smoke waits
 * for the real process instead of the temporary self-copy.
 *
 * @param {string} installDirectory Installed package directory.
 * @returns {readonly string[]} Silent uninstaller arguments.
 */
export function nsisUninstallArguments(installDirectory) {
  return ['/S', `_?=${installDirectory}`];
}

/**
 * Return descendants from a `ps -eo pid=,ppid=` snapshot.
 *
 * @param {readonly {pid: number, parent: number}[]} processes Process tree rows.
 * @param {number} rootPid Process whose descendants should be collected.
 * @returns {Set<number>}
 */
export function descendantPids(processes, rootPid) {
  const descendants = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const process of processes) {
      if (descendants.has(process.parent) && !descendants.has(process.pid)) {
        descendants.add(process.pid);
        changed = true;
      }
    }
  }
  descendants.delete(rootPid);
  return descendants;
}

/**
 * Parse a POSIX process snapshot while preserving the command column.
 *
 * @param {string} output Output from `ps -eo pid=,ppid=,args=`.
 * @returns {Array<{pid: number, parent: number, command: string}>}
 */
export function parseProcessSnapshot(output) {
  return output.split(/\r?\n/).filter(Boolean).flatMap((line) => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s*(.*)$/);
    if (!match) return [];
    const pid = Number(match[1]);
    const parent = Number(match[2]);
    return Number.isInteger(pid) && Number.isInteger(parent)
      ? [{ pid, parent, command: match[3] }]
      : [];
  });
}

/**
 * Test whether a process command line names one packaged executable path.
 * Windows comparisons normalize separators and drive-letter casing.
 *
 * @param {string | undefined} command Process command line.
 * @param {string} executable Absolute packaged executable path.
 * @returns {boolean} Whether the command line names the executable.
 */
export function processCommandIncludesExecutable(command, executable) {
  if (command === undefined) return false;
  const commandPath = command.replaceAll('\\', '/');
  const executablePath = executable.replaceAll('\\', '/');
  const escapedPath = executablePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const windowsPath = /^[A-Za-z]:\//.test(executablePath) || executablePath.startsWith('//');
  return new RegExp(`(?:^|["'\\s])${escapedPath}(?=$|["'\\s])`, windowsPath ? 'i' : '').test(commandPath);
}

/**
 * Return the packaged shell and its managed Node process, including a Node
 * process that was re-parented during shutdown.
 *
 * @param {readonly {pid: number, parent: number, command?: string}[]} processes Process snapshot rows.
 * @param {number} rootPid Packaged shell process id.
 * @param {string} sidecarPath Exact packaged sidecar path.
 * @returns {Set<number>}
 */
export function managedProcessPids(processes, rootPid, sidecarPath) {
  const managed = descendantPids(processes, rootPid);
  for (const process of processes) {
    if (processCommandIncludesExecutable(process.command, sidecarPath)) managed.add(process.pid);
  }
  if (processes.some((process) => process.pid === rootPid)) managed.add(rootPid);
  return managed;
}

/**
 * Locate the target sidecar and deployed CLI from one extracted package root.
 * Symlinks are ignored so the smoke cannot inspect files outside the package.
 *
 * @param {string} root - Extracted AppImage, deb, or app bundle root.
 * @param {{readonly packagedSidecarBasename: string}} target - Target specification.
 * @returns {{sidecar: string, runtime: string}}
 */
export function packagedRuntime(root, target) {
  const sidecars = [];
  const runtimes = [];
  const stack = [root];
  while (stack.length > 0) {
    const directory = stack.pop();
    let entries;
    try { entries = readdirSync(directory, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        stack.push(path);
      } else if (entry.isFile()) {
        if (entry.name === target.packagedSidecarBasename) sidecars.push(path);
        if (entry.name === 'bin.js' && dirname(path).endsWith(`${join('lib')}`)) {
          runtimes.push(dirname(dirname(path)));
        }
      }
    }
  }
  if (sidecars.length !== 1) throw new Error(`expected one packaged sidecar ${target.packagedSidecarBasename}, found ${sidecars.length}`);
  if (runtimes.length !== 1) throw new Error(`expected one packaged runtime lib/bin.js, found ${runtimes.length}`);
  return { sidecar: sidecars[0], runtime: runtimes[0] };
}

/**
 * Run a package-management or installer command without requiring captured stdout.
 *
 * @param {string} command - Executable to run.
 * @param {readonly string[]} args - Arguments passed without shell interpolation.
 * @param {import('node:child_process').SpawnSyncOptions} [options] - Spawn options.
 * @returns {string} Captured stdout, or an empty string when stdio is inherited.
 */
export function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}\n${result.stderr || result.stdout}`);
  }
  return (result.stdout ?? '').trim();
}

function installedDebExecutable(packageName) {
  const files = installedDebFiles(packageName);
  const executable = files.find((file) => file.endsWith('/bin/dsh-desktop'));
  if (!executable || !existsSync(executable)) {
    throw new Error(`installed package ${packageName} has no executable at /bin/dsh-desktop`);
  }
  return executable;
}

function installedDebFiles(packageName) {
  return run('dpkg-query', ['-L', packageName]).split(/\r?\n/).filter(Boolean);
}

/**
 * Resolve the installed sidecar and runtime from one deb package file listing.
 *
 * @param {readonly string[]} files Paths reported by `dpkg-query -L`.
 * @param {{readonly packagedSidecarBasename: string}} target Target sidecar identity.
 * @returns {{sidecar: string, runtime: string}} Installed runtime paths.
 */
export function resolveInstalledDebRuntime(files, target) {
  const sidecars = files.filter((file) => posixPath.basename(file) === target.packagedSidecarBasename);
  const runtimes = files.filter((file) => file.endsWith('/lib/bin.js'));
  if (sidecars.length !== 1) {
    throw new Error(`expected one installed sidecar ${target.packagedSidecarBasename}, found ${sidecars.length}`);
  }
  if (runtimes.length !== 1) {
    throw new Error(`expected one installed runtime lib/bin.js, found ${runtimes.length}`);
  }
  return {
    sidecar: sidecars[0],
    runtime: posixPath.dirname(posixPath.dirname(runtimes[0])),
  };
}

function installedDebRuntime(packageName, target) {
  return resolveInstalledDebRuntime(installedDebFiles(packageName), target);
}

function packageName(artifact) {
  return run('dpkg-deb', ['--field', artifact, 'Package']);
}

function processSnapshot() {
  if (process.platform === 'win32') {
    const output = run('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress',
    ]);
    if (output.length === 0) return [];
    const rows = JSON.parse(output);
    return (Array.isArray(rows) ? rows : [rows]).flatMap((row) => {
      const pid = Number(row.ProcessId);
      const parent = Number(row.ParentProcessId);
      return Number.isInteger(pid) && Number.isInteger(parent)
        ? [{ pid, parent, command: typeof row.CommandLine === 'string' ? row.CommandLine : '' }]
        : [];
    });
  }
  return parseProcessSnapshot(run('ps', ['-eo', 'pid=,ppid=,args=']));
}

function stopProcessTree(child, signal = 'SIGTERM') {
  if (child.pid === undefined) return;
  if (process.platform === 'win32') {
    const force = signal === 'SIGKILL' ? '/F' : undefined;
    const result = spawnSync('taskkill.exe', [
      '/PID', String(child.pid), '/T', ...(force === undefined ? [] : [force]),
    ], { stdio: 'ignore' });
    if (result.error) throw result.error;
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
}

function stopProcessId(pid, signal = 'SIGTERM') {
  if (process.platform === 'win32') {
    const force = signal === 'SIGKILL' ? '/F' : undefined;
    const result = spawnSync('taskkill.exe', [
      '/PID', String(pid), '/T', ...(force === undefined ? [] : [force]),
    ], { stdio: 'ignore' });
    if (result.error) throw result.error;
    return;
  }
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // The process may have exited between the group and direct attempts.
    }
  }
}

async function waitForExit(child, timeoutMs = 10_000) {
  if (child.exitCode !== null) return;
  await new Promise((resolveExit, rejectExit) => {
    const timer = setTimeout(() => rejectExit(new Error('packaged app did not exit after shutdown')), timeoutMs);
    child.once('exit', () => {
      clearTimeout(timer);
      resolveExit();
    });
  });
}

/**
 * Stop one packaged process tree, escalating after a bounded graceful wait.
 * A successful forced stop satisfies cleanup; only a surviving process fails.
 *
 * @param {import('node:child_process').ChildProcess} child Packaged shell process.
 * @param {{stop?: typeof stopProcessTree, wait?: typeof waitForExit}} [options] Test adapters.
 * @returns {Promise<void>}
 */
export async function stopChildWithEscalation(child, options = {}) {
  const stop = options.stop ?? stopProcessTree;
  const wait = options.wait ?? waitForExit;
  stop(child, 'SIGTERM');
  try {
    await wait(child, 10_000);
  } catch (gracefulError) {
    stop(child, 'SIGKILL');
    try {
      await wait(child, 2_000);
    } catch (forcedError) {
      throw new AggregateError(
        [gracefulError, forcedError],
        'packaged app did not exit after forced shutdown',
      );
    }
  }
}

async function waitForManagedProcesses(child, sidecarPath, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const remaining = managedProcessPids(processSnapshot(), child.pid, sidecarPath);
    if (remaining.size === 0) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  const remaining = managedProcessPids(processSnapshot(), child.pid, sidecarPath);
  if (remaining.size > 0) {
    throw new Error(`packaged app left managed processes after shutdown: ${[...remaining].join(', ')}`);
  }
}

async function waitForUpdatedVersion(path, expectedVersion, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  let sawInitialVersion = false;
  while (Date.now() < deadline) {
    if (existsSync(path)) {
      const version = readFileSync(path, 'utf8').trim();
      if (version.length > 0) {
        const observation = observeUpdateVersion(sawInitialVersion, version, expectedVersion);
        sawInitialVersion = observation.sawInitialVersion;
        if (observation.complete) return;
      }
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  const observed = existsSync(path) ? readFileSync(path, 'utf8').trim() : '<missing>';
  throw new Error(`installed update did not reach ${expectedVersion}; last recorded version: ${observed}`);
}

async function stopPackagedProcesses(executable, sidecarPath, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const processes = processSnapshot();
    const roots = processes.filter((process) => processCommandIncludesExecutable(process.command, executable));
    const managed = new Set();
    for (const root of roots) {
      for (const pid of managedProcessPids(processes, root.pid, sidecarPath)) managed.add(pid);
    }
    for (const process of processes) {
      if (processCommandIncludesExecutable(process.command, sidecarPath)) managed.add(process.pid);
    }
    if (managed.size === 0) return;
    for (const pid of managed) stopProcessId(pid);
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  const remaining = processSnapshot().filter((process) =>
    processCommandIncludesExecutable(process.command, executable)
    || processCommandIncludesExecutable(process.command, sidecarPath));
  if (remaining.length > 0) {
    for (const process of remaining) stopProcessId(process.pid, 'SIGKILL');
    throw new Error(`updated packaged app left processes after shutdown: ${remaining.map((process) => process.pid).join(', ')}`);
  }
}

const TERMINAL_SMOKE_MARKER = 'dsh-desktop-terminal-smoke';
const TERMINAL_SMOKE_SCRIPT = [
  "const pty = require('node-pty');",
  "const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh';",
  "const args = process.platform === 'win32' ? ['/d', '/s', '/c', process.argv[1]] : ['-lc', process.argv[1]];",
  "const child = pty.spawn(shell, args, { name: 'xterm-color', cols: 80, rows: 24, cwd: process.cwd(), env: { PATH: process.env.PATH || '', HOME: process.env.HOME || '', TERM: 'xterm-256color' } });",
  `let output = ''; let finished = false; const done = code => { if (finished) return; finished = true; clearTimeout(timer); try { child.kill(); } catch {} process.stdout.write(output); process.exitCode = code; };`,
  `child.onData(data => { output += data; if (output.includes(${JSON.stringify(TERMINAL_SMOKE_MARKER)})) done(0); });`,
  'const timer = setTimeout(() => done(1), 10000);',
].join('');

/**
 * Return the fixed shell command used by the packaged PTY probe.
 *
 * @param {NodeJS.Platform} [platform] Target host platform.
 * @returns {string} Shell-native marker command.
 */
export function terminalSmokeCommand(platform = process.platform) {
  return platform === 'win32'
    ? `echo ${TERMINAL_SMOKE_MARKER}`
    : `printf ${TERMINAL_SMOKE_MARKER}`;
}

function terminalSmokeEnvironment(home, runtime) {
  const environment = {
    PATH: process.env.PATH ?? '',
    HOME: process.env.HOME ?? runtime,
    DSH_HOME: home,
  };
  if (process.platform === 'win32') {
    for (const name of ['ComSpec', 'COMSPEC', 'SystemRoot', 'TEMP', 'TMP', 'USERPROFILE', 'PATHEXT']) {
      const value = process.env[name];
      if (value !== undefined) environment[name] = value;
    }
  }
  return environment;
}

/**
 * Execute one fixed command through the packaged runtime's node-pty module.
 * The sidecar and runtime are both resolved from the installed artifact.
 *
 * @param {{sidecar: string, runtime: string}} runtimePaths - Installed runtime paths.
 * @returns {Promise<string>} Captured PTY output.
 */
export async function runTerminalSmoke(runtimePaths) {
  const { sidecar, runtime } = runtimePaths;
  const child = spawn(sidecar, ['-e', TERMINAL_SMOKE_SCRIPT, terminalSmokeCommand()], {
    cwd: runtime,
    env: terminalSmokeEnvironment(process.env.DSH_HOME ?? runtime, runtime),
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', chunk => { output += String(chunk); });
  child.stderr.on('data', chunk => { output += String(chunk); });
  try {
    await waitForExit(child, 15_000);
  } catch (error) {
    stopProcessTree(child, 'SIGKILL');
    await waitForExit(child, 2_000).catch(() => {});
    throw error;
  }
  if (child.exitCode !== 0 || !output.includes(TERMINAL_SMOKE_MARKER)) {
    throw new Error(`packaged terminal command failed (exit=${child.exitCode})\n${output}`);
  }
  return output;
}

/**
 * Exercise the web UI served by an installed package while its bundled shell
 * and runtime remain alive. This uses a separate Chromium process because
 * the target runner's native Tauri WebView is not remotely attachable; native
 * window and WebView evidence remains a separate acceptance requirement.
 *
 * @param {string} url - Readiness URL printed by the packaged shell.
 * @param {{screenshotPath?: string}} [options] - Optional screenshot output.
 * @returns {Promise<{title: string, url: string}>} Observed page identity.
 */
export async function runPackagedWebSmoke(url, options = {}) {
  let chromium;
  try {
    ({ chromium } = requireWebDependency('playwright'));
  } catch (error) {
    throw new Error(`packaged web smoke requires Playwright: ${error instanceof Error ? error.message : String(error)}`);
  }
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    if (response === null || !response.ok()) {
      throw new Error(`packaged web UI returned ${response?.status() ?? 'no response'} at ${url}`);
    }
    await page.locator('[data-composer-seat]').waitFor({ state: 'attached', timeout: 30_000 });
    await page.locator('textarea').waitFor({ state: 'attached', timeout: 30_000 });
    const title = await page.title();
    if (!/DeepSeek Harness|DSH Local Build/.test(title)) {
      throw new Error(`packaged web UI has unexpected document title: ${title}`);
    }
    if (options.screenshotPath !== undefined) {
      await page.screenshot({ path: options.screenshotPath, fullPage: true });
    }
    return { title, url: page.url() };
  } finally {
    await browser.close();
  }
}

/**
 * Assert that package removal did not remove data owned by the user.
 *
 * @param {string} home - The temporary DSH_HOME used by the smoke.
 * @param {string} marker - A marker created before installation or launch.
 * @returns {void}
 */
export function assertUserDataRetained(home, marker) {
  if (!existsSync(home) || !statSync(home).isDirectory()) {
    throw new Error(`user data directory was removed: ${home}`);
  }
  if (!existsSync(marker) || statSync(marker).size === 0) {
    throw new Error(`user data marker was removed: ${marker}`);
  }
}

/**
 * Remove the temporary smoke home after installers release their file handles.
 *
 * @param {string} home Temporary DSH_HOME and installation root.
 * @param {(path: string, options: import('node:fs').RmDirOptions) => void} [remove] Removal implementation.
 * @returns {void}
 */
export function removeTemporaryHome(home, remove = rmSync) {
  remove(home, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
}

async function launch(command, args, env, sidecarPath, { stopAfterReady = true } = {}) {
  const child = spawn(command, args, {
    env,
    cwd: dirname(command),
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  const append = (chunk) => { output += String(chunk); };
  child.stdout.on('data', append);
  child.stderr.on('data', append);
  const ready = new Promise((resolveReady, rejectReady) => {
    const timer = setTimeout(() => {
      stopProcessTree(child);
      const diagnostics = env.DSH_PACKAGED_SMOKE_SPLASH_DIR === undefined
        ? ''
        : splashLogDiagnostics(env.DSH_PACKAGED_SMOKE_SPLASH_DIR);
      rejectReady(new Error(`packaged app did not reach readiness within 130s\n${output}${diagnostics}`));
    }, 130_000);
    const check = () => {
      const match = output.match(/\[dsh-desktop\] ready at (https?:\/\/[^\s\r\n]+)/);
      if (!match) return;
      clearTimeout(timer);
      try {
        new URL(match[1]);
      } catch {
        clearTimeout(timer);
        rejectReady(new Error(`packaged app printed an invalid readiness URL: ${match[1]}`));
        return;
      }
      resolveReady(match[1]);
    };
    child.stdout.on('data', check);
    child.stderr.on('data', check);
    child.on('error', (error) => {
      clearTimeout(timer);
      rejectReady(error);
    });
    child.on('exit', (code, signal) => {
      if (code !== null) {
        clearTimeout(timer);
        rejectReady(new Error(`packaged app exited before readiness (code=${code}, signal=${signal})\n${output}`));
      }
    });
  });
  const url = await ready;
  if (!stopAfterReady) return { url, child };
  await stopChildWithEscalation(child);
  try {
    await waitForManagedProcesses(child, sidecarPath);
  } catch (error) {
    stopProcessTree(child, 'SIGKILL');
    await waitForManagedProcesses(child, sidecarPath, 2_000).catch(() => {});
    throw error;
  }
  return { url, child };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (!existsSync(options.artifact) || statSync(options.artifact).size === 0) {
    throw new Error(`package artifact is missing or empty: ${options.artifact}`);
  }
  const home = mkdtempSync(join(tmpdir(), 'dsh-desktop-packaged-smoke-'));
  const userDataMarker = join(home, 'desktop-smoke-user-data.marker');
  writeFileSync(userDataMarker, 'user-owned desktop smoke data\n', { encoding: 'utf8' });
  let installedDeb;
  let installedDmg;
  let installedWindows;
  let mountedDmg;
  let runningChild;
  let sidecarPath;
  let smokeCompleted = false;
  try {
    let executable;
    let packageRoot;
    let runtimePaths;
    if (options.installNsis) {
      installedWindows = join(home, 'installed');
      mkdirSync(installedWindows);
      run(options.artifact, ['/S', `/D=${installedWindows}`], { stdio: 'inherit' });
      packageRoot = installedWindows;
      executable = packagedExecutable(installedWindows, options.target);
      if (!existsSync(executable)) throw new Error(`NSIS install has no executable: ${executable}`);
    } else if (options.installDeb) {
      installedDeb = packageName(options.artifact);
      run('sudo', ['dpkg', '--install', options.artifact], { stdio: 'inherit' });
      executable = installedDebExecutable(installedDeb);
      runtimePaths = installedDebRuntime(installedDeb, options.target);
    } else if (options.installDmg) {
      mountedDmg = join(home, 'dmg-mount');
      mkdirSync(mountedDmg);
      run('hdiutil', dmgMountArguments(options.artifact, mountedDmg), { stdio: 'inherit' });
      const app = join(mountedDmg, 'dsh-desktop.app');
      if (!existsSync(app)) throw new Error(`mounted dmg has no dsh-desktop.app: ${app}`);
      installedDmg = macosInstallRoot(mkdtempSync(join(tmpdir(), 'dsh-desktop-packaged-install-')));
      const copiedApp = join(installedDmg, 'dsh-desktop.app');
      run('ditto', dmgInstallArguments(app, copiedApp), { stdio: 'inherit' });
      run('hdiutil', ['detach', mountedDmg], { stdio: 'inherit' });
      mountedDmg = undefined;
      executable = packagedExecutable(copiedApp, options.target);
      packageRoot = copiedApp;
    } else if (options.target.productTarget === 'macos-arm64') {
      packageRoot = options.artifact;
      executable = packagedExecutable(packageRoot, options.target);
    } else {
      const extracted = join(home, 'squashfs-root');
      run(options.artifact, ['--appimage-extract'], { cwd: home, stdio: 'ignore' });
      executable = packagedExecutable(extracted, options.target);
      packageRoot = extracted;
      if (!existsSync(executable)) {
        throw new Error(`extracted AppImage has no executable: ${executable}`);
      }
    }
    if (!existsSync(executable)) throw new Error(`package has no executable: ${executable}`);
    if (runtimePaths === undefined) {
      if (packageRoot === undefined) throw new Error('packaged smoke has no package root');
      runtimePaths = packagedRuntime(packageRoot, options.target);
    }
    sidecarPath = runtimePaths.sidecar;
    const updateResult = join(home, 'update-version.txt');
    const nativeTemp = join(home, 'native-tmp');
    mkdirSync(nativeTemp);
    const launched = await launch(executable, [], {
      ...process.env,
      APPIMAGE_EXTRACT_AND_RUN: '1',
      DSH_HOME: home,
      ...(options.target.productTarget === 'macos-arm64' ? {
        DSH_PACKAGED_SMOKE_SPLASH_DIR: nativeTemp,
        TMPDIR: nativeTemp,
      } : {}),
      ...(options.updateSmoke ? {
        DSH_DESKTOP_UPDATE_SMOKE: '1',
        DSH_DESKTOP_UPDATE_RESULT: updateResult,
      } : {}),
    }, sidecarPath, { stopAfterReady: !(options.updateSmoke || options.webSmoke) });
    runningChild = launched.child;
    if (options.webSmoke) {
      const webResult = await runPackagedWebSmoke(launched.url, {
        screenshotPath: process.env.DSH_PACKAGED_WEB_SMOKE_SCREENSHOT,
      });
      console.log(`[packaged-smoke] web UI title: ${webResult.title}`);
    }
    if (options.terminalSmoke) {
      const output = await runTerminalSmoke(runtimePaths);
      console.log(`[packaged-smoke] terminal output: ${output.trim()}`);
    }
    if (options.updateSmoke) {
      await waitForUpdatedVersion(updateResult, options.expectedVersion);
      await stopPackagedProcesses(executable, sidecarPath);
      console.log(`[packaged-smoke] updated to ${options.expectedVersion}`);
    }
    if (options.webSmoke) {
      await stopPackagedProcesses(executable, sidecarPath);
    }
    console.log(`[packaged-smoke] ready at ${launched.url}`);
    smokeCompleted = true;
  } finally {
    if (runningChild !== undefined && runningChild.exitCode === null) {
      stopProcessTree(runningChild);
      try {
        await waitForExit(runningChild);
      } catch {
        stopProcessTree(runningChild, 'SIGKILL');
        await waitForExit(runningChild, 2_000).catch(() => {});
      }
      if (sidecarPath !== undefined) {
        await waitForManagedProcesses(runningChild, sidecarPath, 2_000).catch(() => {});
      }
    }
    if (mountedDmg !== undefined) {
      run('hdiutil', ['detach', mountedDmg, '-force'], { stdio: 'inherit' });
    }
    if (installedWindows !== undefined) {
      const uninstaller = join(installedWindows, 'uninstall.exe');
      if (existsSync(uninstaller)) run(uninstaller, nsisUninstallArguments(installedWindows), { stdio: 'inherit' });
      else throw new Error(`NSIS install has no uninstaller: ${uninstaller}`);
    }
    if (installedDeb !== undefined) {
      run('sudo', ['dpkg', '--purge', installedDeb], { stdio: 'inherit' });
    }
    if (installedDmg !== undefined) removeTemporaryHome(installedDmg);
    if (smokeCompleted) assertUserDataRetained(home, userDataMarker);
    removeTemporaryHome(home);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`[packaged-smoke] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
