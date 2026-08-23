// Validate the native files that enter one target-owned desktop runtime.
// The target row supplies the selected prebuild directory; this module owns
// the filesystem checks that prove pruning did not leave another platform's
// native bytes behind.
import {
  existsSync,
  lstatSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

import { SUPPORTED_TARGETS } from './target-spec.mjs';

const NATIVE_FILE_EXTENSIONS = new Set(['.dll', '.dylib', '.exe', '.node', '.so']);
const FOREIGN_PLATFORM_EXTENSIONS = Object.freeze({
  windows: new Set(['.dylib', '.so']),
  linux: new Set(['.dll', '.dylib', '.exe']),
  macos: new Set(['.dll', '.exe']),
});
const SUPPORTED_NATIVE_PLATFORM_KEYS = new Set(
  Object.values(SUPPORTED_TARGETS).map((target) => target.nativePlatformKey),
);

/**
 * Remove non-target children from native `prebuilds` directories and from the
 * selected target's Koffi optional package.
 *
 * @param {string} root Runtime directory to mutate.
 * @param {{nativePlatformKey: string}} target Selected desktop target.
 * @returns {void}
 * @throws If a prebuilds directory has neither a current-target binary nor a
 * source-built native binary beside the prebuilds directory.
 */
export function pruneNativeRuntime(root, target) {
  forEachDirectory(root, (directory) => {
    if (directory.name !== 'prebuilds') return;
    const current = join(directory.path, target.nativePlatformKey);
    if (!hasNativeFile(current)) {
      if (!hasNativeFile(dirname(directory.path), directory.path)) {
        throw new Error(`native binary missing for ${target.nativePlatformKey}: ${dirname(directory.path)}`);
      }
      for (const entry of safeReadDir(directory.path)) removePath(join(directory.path, entry.name));
      return;
    }
    for (const entry of safeReadDir(directory.path)) {
      if (entry.name === target.nativePlatformKey) continue;
      removePath(join(directory.path, entry.name));
    }
  });

  const koffiPackageRoot = targetKoffiPackageRoot(root, target);
  const currentKoffiDirectory = koffiNativeDirectory(target);
  for (const entry of safeReadDir(koffiPackageRoot)) {
    const path = join(koffiPackageRoot, entry.name);
    if (!entry.isDirectory() || entry.name === currentKoffiDirectory || !hasNativeFile(path)) continue;
    removePath(path);
  }
}

/**
 * Check that the target runtime contains usable native dependencies and no
 * selected-row platform files or Koffi ABI directories for another target.
 *
 * @param {string} root Runtime directory to inspect.
 * @param {{nativePlatformKey: string, rustTriple: string}} target Selected desktop target.
 * @returns {void}
 * @throws If a required native package is empty or a foreign native file is found.
 */
export function validateNativeRuntime(root, target) {
  const nativeFiles = [];
  const prebuilds = [];
  walk(root, (path, entry) => {
    if (entry.isDirectory() && entry.name === 'prebuilds') prebuilds.push(path);
    if (!entry.isFile()) return;
    const extension = extensionOf(entry.name);
    if (NATIVE_FILE_EXTENSIONS.has(extension)) nativeFiles.push({ path, extension });
  });

  for (const directory of prebuilds) {
    const current = join(directory, target.nativePlatformKey);
    if (!hasNativeFile(current) && !hasNativeFile(dirname(directory), directory)) {
      throw new Error(`native binary missing for ${target.nativePlatformKey}: ${dirname(directory)}`);
    }
  }

  for (const packageName of ['node-pty', 'koffi']) {
    const packageRoot = findPackageRoot(root, packageName);
    const targetPackageRoot = packageName === 'koffi'
      ? join(targetKoffiPackageRoot(root, target), koffiNativeDirectory(target))
      : undefined;
    if (packageRoot && !hasNativeFile(packageRoot) && !hasNativeFile(targetPackageRoot)) {
      throw new Error(`native package has no loadable binary: ${packageRoot}`);
    }
  }

  const koffiPackageRoot = targetKoffiPackageRoot(root, target);
  const currentKoffiDirectory = koffiNativeDirectory(target);
  for (const entry of safeReadDir(koffiPackageRoot)) {
    const path = join(koffiPackageRoot, entry.name);
    if (entry.isDirectory() && entry.name !== currentKoffiDirectory && hasNativeFile(path)) {
      throw new Error(`foreign Koffi ABI ${entry.name} in runtime: ${path}`);
    }
  }

  const platform = target.rustTriple.includes('windows')
    ? 'windows'
    : target.rustTriple.includes('linux')
      ? 'linux'
      : 'macos';
  const foreignExtensions = FOREIGN_PLATFORM_EXTENSIONS[platform];
  for (const file of nativeFiles) {
    const relative = file.path.slice(root.length + 1);
    const foreignKey = [...SUPPORTED_NATIVE_PLATFORM_KEYS].find(
      (key) => relative.split(/[\\/]/u).includes(key) && key !== target.nativePlatformKey,
    );
    if (foreignKey) {
      throw new Error(`foreign native platform ${foreignKey} in runtime: ${file.path}`);
    }
    if (foreignExtensions.has(file.extension)) {
      throw new Error(`foreign native file for ${platform} runtime: ${file.path}`);
    }
  }
}

function findPackageRoot(root, packageName) {
  const packageRoot = join(root, 'node_modules', packageName);
  return existsSync(packageRoot) ? packageRoot : undefined;
}

function targetKoffiPackageRoot(root, target) {
  return join(root, 'node_modules', '@koromix', `koffi-${target.nativePlatformKey}`);
}

function koffiNativeDirectory(target) {
  return target.nativePlatformKey.replaceAll('-', '_');
}

function hasNativeFile(root, excludedRoot) {
  if (!existsSync(root)) return false;
  let found = false;
  walk(root, (path, entry) => {
    if (path === excludedRoot) return false;
    if (entry.isFile() && NATIVE_FILE_EXTENSIONS.has(extensionOf(entry.name))) found = true;
  });
  return found;
}

function extensionOf(name) {
  const index = name.lastIndexOf('.');
  return index < 0 ? '' : name.slice(index).toLowerCase();
}

function forEachDirectory(root, visit) {
  walk(root, (path, entry) => {
    if (entry.isDirectory()) visit({ name: entry.name, path });
  });
}

function walk(root, visit) {
  if (!existsSync(root)) return;
  const stack = [root];
  while (stack.length > 0) {
    const directory = stack.pop();
    for (const entry of safeReadDir(directory)) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (visit(path, entry) !== false && entry.isDirectory()) stack.push(path);
    }
  }
}

function safeReadDir(directory) {
  try {
    return readdirSync(directory, { withFileTypes: true });
  } catch {
    return [];
  }
}

function removePath(path) {
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    return;
  }
  if (stat.isSymbolicLink()) {
    rmSync(path, { force: true });
    return;
  }
  rmSync(path, { recursive: stat.isDirectory(), force: true });
}
