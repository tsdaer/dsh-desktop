// Launch a Linux or macOS package under a temporary DSH_HOME and verify the packaged
// shell reaches its runtime readiness line before the process tree is stopped.
// The smoke intentionally runs the installed entry point, not `cargo run` or
// the source CLI, so resource lookup and the target Node sidecar are included.
import { cpSync, existsSync, mkdtempSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

import { resolveTargetFromArgs } from './target-spec.mjs';

/**
 * Parse the Linux packaged-smoke options.
 *
 * @param {readonly string[]} argv Arguments after the script name.
 * @returns {{target: Readonly<object>, artifact: string, installDeb: boolean}}
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
  return { target, artifact: resolve(artifact), installDeb, installDmg };
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
  const output = run('ps', ['-eo', 'pid=,ppid=']);
  return output.split(/\r?\n/).filter(Boolean).flatMap((line) => {
    const fields = line.trim().split(/\s+/).map(Number);
    return fields.length === 2 && fields.every(Number.isInteger)
      ? [{ pid: fields[0], parent: fields[1] }]
      : [];
  });
}

function stopProcessTree(child) {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
}

async function launch(command, args, env) {
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
  const descendants = descendantPids(processSnapshot(), child.pid);
  stopProcessTree(child);
  if (child.exitCode === null) {
    await new Promise((resolveExit, rejectExit) => {
      child.once('exit', (code, signal) => {
        if (code !== null || signal === 'SIGTERM' || signal === 'SIGKILL') resolveExit();
        else rejectExit(new Error(`packaged app stopped unexpectedly (code=${code}, signal=${signal})`));
      });
    });
  }
  const remaining = descendantPids(processSnapshot(), child.pid);
  if ([...descendants].some((pid) => remaining.has(pid))) {
    throw new Error(`packaged app left a child process after shutdown: ${[...remaining].join(', ')}`);
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
    if (options.installDeb) {
      installed = packageName(options.artifact);
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
    } else {
      const extracted = join(home, 'squashfs-root');
      run(options.artifact, ['--appimage-extract'], { cwd: home, stdio: 'ignore' });
      executable = packagedExecutable(extracted, options.target);
      if (!existsSync(executable)) {
        throw new Error(`extracted AppImage has no executable: ${executable}`);
      }
    }
    const url = await launch(executable, [], {
      ...process.env,
      APPIMAGE_EXTRACT_AND_RUN: '1',
      DSH_HOME: home,
    });
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
