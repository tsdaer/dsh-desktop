import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { artifactDirectoriesFor } from './target-spec.mjs';

/**
 * Read a JSON Tauri configuration layer from the desktop package.
 *
 * @param {string} path
 * @returns {Record<string, unknown>}
 */
function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * Merge configuration objects using Tauri's object-and-array semantics.
 * Arrays are replaced by the later layer; nested objects are merged.
 *
 * @param {Record<string, unknown>} base
 * @param {Record<string, unknown>} overlay
 * @returns {Record<string, unknown>}
 */
export function mergeTauriConfig(base, overlay) {
  const result = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    const previous = result[key];
    if (isRecord(previous) && isRecord(value)) {
      result[key] = mergeTauriConfig(previous, value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Resolve the reviewed base and target-specific Tauri configuration files.
 *
 * @param {Readonly<{tauriConfig: string}>} target
 * @param {string} desktopRoot
 * @returns {{basePath: string, targetPath: string}}
 */
export function tauriConfigPaths(target, desktopRoot) {
  const basePath = resolve(desktopRoot, 'src-tauri/tauri.conf.json');
  const targetPath = resolve(desktopRoot, target.tauriConfig);
  if (!existsSync(basePath)) throw new Error(`missing Tauri base config: ${basePath}`);
  if (!existsSync(targetPath)) throw new Error(`missing Tauri target config: ${targetPath}`);
  return { basePath, targetPath };
}

/**
 * Render and validate the effective configuration without writing a generated
 * file. Tauri receives the same target layer through `--config` at bundle
 * time, so this check covers the configuration that the command will merge.
 *
 * @param {Readonly<{bundleKinds: readonly string[], rustTriple: string, tauriConfig: string, updaterPlatform: string}>} target
 * @param {string} desktopRoot
 * @returns {Readonly<Record<string, unknown>>}
 */
export function effectiveTauriConfig(target, desktopRoot) {
  const { basePath, targetPath } = tauriConfigPaths(target, desktopRoot);
  const config = mergeTauriConfig(readJson(basePath), readJson(targetPath));
  const bundle = isRecord(config.bundle) ? config.bundle : {};
  const plugins = isRecord(config.plugins) ? config.plugins : {};
  const updater = isRecord(plugins.updater) ? plugins.updater : {};
  const resources = isRecord(bundle.resources) ? bundle.resources : {};
  const targets = Array.isArray(bundle.targets) ? bundle.targets : [];
  if (JSON.stringify(targets) !== JSON.stringify([...target.bundleKinds])) {
    throw new Error(`Tauri bundle targets do not match ${target.rustTriple}`);
  }
  const resourceEntries = Object.entries(resources);
  if (resourceEntries.length !== 1 || resourceEntries[0][1] !== 'runtime' || !resourceEntries[0][0].includes(target.rustTriple)) {
    throw new Error(`Tauri resources must stage the target runtime as runtime for ${target.rustTriple}`);
  }
  if (JSON.stringify(bundle.externalBin) !== JSON.stringify(['binaries/node'])) {
    throw new Error('Tauri externalBin must contain only binaries/node');
  }
  if (target.updaterPlatform === 'windows-x86_64' && !isRecord(updater.windows)) {
    throw new Error('Windows updater install mode is missing from the Windows config');
  }
  if (target.updaterPlatform !== 'windows-x86_64' && isRecord(updater.windows)) {
    throw new Error(`Windows updater settings leaked into ${target.rustTriple}`);
  }
  return config;
}

/**
 * Return the CLI arguments for a target-specific Tauri build.
 *
 * @param {Readonly<{rustTriple: string, tauriConfig: string}>} target
 * @param {string} desktopRoot
 * @returns {string[]}
 */
export function tauriBuildArgs(target, desktopRoot) {
  return ['--ci', '--target', target.rustTriple, '--config', resolve(desktopRoot, target.tauriConfig)];
}

/**
 * Return the target's artifact directories for size and release checks.
 *
 * @param {Readonly<{artifactDirectories: readonly string[], rustTriple: string}>} target
 * @param {string} desktopRoot
 * @returns {string[]}
 */
export function targetArtifactDirectories(target, desktopRoot) {
  return artifactDirectoriesFor(target, desktopRoot);
}

/**
 * Return the resource source path expected by the effective target config.
 *
 * @param {Readonly<{rustTriple: string}>} target
 * @param {string} desktopRoot
 * @returns {string}
 */
export function targetRuntimePath(target, desktopRoot) {
  return join(desktopRoot, '.runtime', target.rustTriple, 'deploy');
}
