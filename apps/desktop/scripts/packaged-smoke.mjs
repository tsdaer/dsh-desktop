// Launch a Linux or macOS package under a temporary DSH_HOME and verify the packaged
// shell reaches its runtime readiness line before the process tree is stopped.
// The smoke intentionally runs the installed entry point, not `cargo run` or
// the source CLI, so resource lookup and the target Node sidecar are included.
import { cpSync, existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

import { resolveTargetFromArgs } from './target-spec.mjs';

/**
 * Parse the Linux packaged-smoke options.
 *
 * @param {readonly string[]} argv Arguments after the script name.
 * @returns {{target: Readonly<object>, artifact: string, installDeb: boolean, installDmg: boolean, terminalSmoke: boolean}}
 */
export function parseArguments(argv) {
  const target = resolveTargetFromArgs(argv);
  if (target.productTarget !== 'linux-x64' && target.productTarget !== 'macos-arm64') {
    throw new Error(`packaged smoke supports Linux x64 and macOS arm64 only: ${target.rustTriple}`);
  }
  const artifactIndex = argv.indexOf('--artifact');
  const artifact = artifactIndex < 0 ? undefined : argv[artifactIndex + 1];
  if (!artifact || artifact.startsWith('-')) throw new Error('--artifact requires a package path');
  const installDeb = argv.includes('--install-deb');
  const installDmg = argv.includes('--install-dmg');
  const terminalSmoke = argv.includes('--terminal-smoke');
  if (installDeb && installDmg) throw new Error('--install-deb and --install-dmg are mutually exclusive');
  if (target.productTarget === 'linux-x64' && installDmg) {
    throw new Error('--install-dmg is only available for macOS arm64');
  }
  if (target.productTarget === 'macos-arm64' && installDeb) {
    throw new Error('--install-deb is only available for Linux x64');
  }
  const expectedSuffix = target.productTarget === 'linux-x64'
    ? (installDeb ? '.deb' : '.AppImage')
    : (installDmg ? '.dmg' : '.app');
  if (!artifact.endsWith(expectedSuffix)) {
    throw new Error(`expected a ${expectedSuffix} artifact: ${artifact}`);
  }
  return { target, artifact: resolve(artifact), installDeb, installDmg, terminalSmoke };
}

/**
 * Resolve the executable inside an unpacked package or app bundle.
 *
 * @param {string} root - Extracted package root or `.app` directory.
 * @param {{readonly productTarget: string}} target - Resolved desktop target.
 * @returns {string} Packaged shell executable path.
 */
export function packagedExecutable(root, target) {
  if (target.productTarget === 'linux-x64') return join(root, 'usr', 'bin', 'dsh-desktop');
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
 * Return the packaged shell and its managed Node process, including a Node
 * process that was re-parented during shutdown.
 *
 * @param {readonly {pid: number, parent: number, command?: string}[]} processes Process snapshot rows.
 * @param {number} rootPid Packaged shell process id.
 * @param {string} sidecarBasename Exact target sidecar basename.
 * @returns {Set<number>}
 */
export function managedProcessPids(processes, rootPid, sidecarBasename) {
  const managed = descendantPids(processes, rootPid);
  for (const process of processes) {
    if (process.command?.includes(sidecarBasename)) managed.add(process.pid);
  }
  if (processes.some((process) => process.pid === rootPid)) managed.add(rootPid);
  return managed;
}

/**
 * Locate the target sidecar and deployed CLI from one extracted package root.
 * Symlinks are ignored so the smoke cannot inspect files outside the package.
 *
 * @param {string} root - Extracted AppImage, deb, or app bundle root.
 * @param {{readonly sidecarBasename: string}} target - Target specification.
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
        if (entry.name === target.sidecarBasename) sidecars.push(path);
        if (entry.name === 'bin.js' && dirname(path).endsWith(`${join('lib')}`)) {
          runtimes.push(dirname(dirname(path)));
        }
      }
    }
  }
  if (sidecars.length !== 1) throw new Error(`expected one packaged sidecar ${target.sidecarBasename}, found ${sidecars.length}`);
  if (runtimes.length !== 1) throw new Error(`expected one packaged runtime lib/bin.js, found ${runtimes.length}`);
  return { sidecar: sidecars[0], runtime: runtimes[0] };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}\n${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

function installedDebExecutable(packageName) {
  const files = run('dpkg-query', ['-L', packageName]).split(/\r?\n/).filter(Boolean);
  const executable = files.find((file) => file.endsWith('/bin/dsh-desktop'));
  if (!executable || !existsSync(executable)) {
    throw new Error(`installed package ${packageName} has no executable at /bin/dsh-desktop`);
  }
  return executable;
}

function packageName(artifact) {
  return run('dpkg-deb', ['--field', artifact, 'Package']);
}

function processSnapshot() {
  return parseProcessSnapshot(run('ps', ['-eo', 'pid=,ppid=,args=']));
}

function stopProcessTree(child, signal = 'SIGTERM') {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
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

async function waitForManagedProcesses(child, sidecarBasename, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const remaining = managedProcessPids(processSnapshot(), child.pid, sidecarBasename);
    if (remaining.size === 0) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  const remaining = managedProcessPids(processSnapshot(), child.pid, sidecarBasename);
  if (remaining.size > 0) {
    throw new Error(`packaged app left managed processes after shutdown: ${[...remaining].join(', ')}`);
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
 * Execute one fixed command through the packaged runtime's node-pty module.
 * The sidecar and runtime are both resolved from the installed artifact.
 *
 * @param {string} packageRoot - Extracted package root.
 * @param {Readonly<{sidecarBasename: string}>} target - Target specification.
 * @returns {Promise<string>} Captured PTY output.
 */
export async function runTerminalSmoke(packageRoot, target) {
  const { sidecar, runtime } = packagedRuntime(packageRoot, target);
  const child = spawn(sidecar, ['-e', TERMINAL_SMOKE_SCRIPT, `printf ${TERMINAL_SMOKE_MARKER}`], {
    cwd: runtime,
    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', DSH_HOME: process.env.DSH_HOME ?? runtime },
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

async function launch(command, args, env, sidecarBasename) {
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
      rejectReady(new Error(`packaged app did not reach readiness within 120s\n${output}`));
    }, 120_000);
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
  stopProcessTree(child);
  try {
    await waitForExit(child);
  } catch (error) {
    stopProcessTree(child, 'SIGKILL');
    await waitForExit(child, 2_000).catch(() => {});
    throw error;
  }
  try {
    await waitForManagedProcesses(child, sidecarBasename);
  } catch (error) {
    stopProcessTree(child, 'SIGKILL');
    await waitForManagedProcesses(child, sidecarBasename, 2_000).catch(() => {});
    throw error;
  }
  return url;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (!existsSync(options.artifact) || statSync(options.artifact).size === 0) {
    throw new Error(`package artifact is missing or empty: ${options.artifact}`);
  }
  const home = mkdtempSync(join(tmpdir(), 'dsh-desktop-packaged-smoke-'));
  let installed;
  let mountedDmg;
  let smokeCompleted = false;
  try {
    let executable;
    let packageRoot;
    if (options.installDeb) {
      installed = packageName(options.artifact);
      packageRoot = join(home, 'deb-root');
      mkdirSync(packageRoot);
      run('dpkg-deb', ['--extract', options.artifact, packageRoot]);
      run('sudo', ['dpkg', '--install', options.artifact], { stdio: 'inherit' });
      executable = installedDebExecutable(installed);
    } else if (options.installDmg) {
      mountedDmg = join(home, 'dmg-mount');
      mkdirSync(mountedDmg);
      run('hdiutil', dmgMountArguments(options.artifact, mountedDmg), { stdio: 'inherit' });
      const app = join(mountedDmg, 'dsh-desktop.app');
      if (!existsSync(app)) throw new Error(`mounted dmg has no dsh-desktop.app: ${app}`);
      const copiedApp = join(home, 'installed', 'dsh-desktop.app');
      mkdirSync(dirname(copiedApp), { recursive: true });
      cpSync(app, copiedApp, { recursive: true });
      run('hdiutil', ['detach', mountedDmg], { stdio: 'inherit' });
      mountedDmg = undefined;
      executable = packagedExecutable(copiedApp, options.target);
      packageRoot = copiedApp;
    } else {
      const extracted = join(home, 'squashfs-root');
      run(options.artifact, ['--appimage-extract'], { cwd: home, stdio: 'ignore' });
      executable = packagedExecutable(extracted, options.target);
      packageRoot = extracted;
      if (!existsSync(executable)) {
        throw new Error(`extracted AppImage has no executable: ${executable}`);
      }
    }
    const url = await launch(executable, [], {
      ...process.env,
      APPIMAGE_EXTRACT_AND_RUN: '1',
      DSH_HOME: home,
    }, options.target.sidecarBasename);
    if (options.terminalSmoke) {
      if (packageRoot === undefined) throw new Error('packaged terminal smoke has no package root');
      const output = await runTerminalSmoke(packageRoot, options.target);
      console.log(`[packaged-smoke] terminal output: ${output.trim()}`);
    }
    console.log(`[packaged-smoke] ready at ${url}`);
    smokeCompleted = true;
  } finally {
    if (mountedDmg !== undefined) {
      run('hdiutil', ['detach', mountedDmg, '-force'], { stdio: 'inherit' });
    }
    if (installed !== undefined) {
      run('sudo', ['dpkg', '--purge', installed], { stdio: 'inherit' });
    }
    if (smokeCompleted && !existsSync(home)) throw new Error(`smoke DSH_HOME was removed: ${home}`);
    rmSync(home, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`[packaged-smoke] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
