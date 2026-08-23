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
 * Build the updater configuration used by a target-runner update smoke.
 * Production builds keep the endpoint from tauri.conf.json; this explicit
 * overlay is only for a fixture server owned by the smoke.
 *
 * @param {string} endpoint HTTP(S) endpoint returning latest.json.
 * @returns {{plugins: {updater: {endpoints: string[]}}}}
 */
export function updaterEndpointConfig(endpoint) {
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error(`updater smoke endpoint is invalid: ${endpoint}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`updater smoke endpoint must use HTTP(S): ${endpoint}`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('updater smoke endpoint must not contain credentials, a query, or a fragment');
  }
  return { plugins: { updater: { endpoints: [url.href] } } };
}

/**
 * Resolve the reviewed base and target-specific Tauri configuration files.
 *
 * @param {Readonly<{tauriConfig: string}>} target
 * @param {string} desktopRoot
 * @param {string} [targetConfig=target.tauriConfig] Reviewed overlay path.
 * @param {string} [extraConfigPath] Optional later config layer.
 * @returns {{basePath: string, targetPath: string, extraConfigPath?: string}}
 */
export function tauriConfigPaths(target, desktopRoot, targetConfig = target.tauriConfig, extraConfigPath) {
  const basePath = resolve(desktopRoot, 'src-tauri/tauri.conf.json');
  const targetPath = resolve(desktopRoot, targetConfig);
  if (!existsSync(basePath)) throw new Error(`missing Tauri base config: ${basePath}`);
  if (!existsSync(targetPath)) throw new Error(`missing Tauri target config: ${targetPath}`);
  if (extraConfigPath !== undefined && !existsSync(extraConfigPath)) {
    throw new Error(`missing extra Tauri config: ${extraConfigPath}`);
  }
  return { basePath, targetPath, extraConfigPath };
}

/**
 * Render and validate the effective configuration without writing a generated
 * file. Tauri receives the same target layer through `--config` at bundle
 * time, so this check covers the configuration that the command will merge.
 *
 * @param {Readonly<{bundleKinds: readonly string[], runtimeRelativeDir: string, rustTriple: string, tauriConfig: string, updaterPlatform: string}>} target
 * @param {string} desktopRoot
 * @param {string} [targetConfig=target.tauriConfig] Reviewed overlay path.
 * @param {string} [extraConfigPath] Optional later config layer.
 * @returns {Readonly<Record<string, unknown>>}
 */
export function effectiveTauriConfig(target, desktopRoot, targetConfig = target.tauriConfig, extraConfigPath) {
  const { basePath, targetPath } = tauriConfigPaths(target, desktopRoot, targetConfig, extraConfigPath);
  let config = mergeTauriConfig(readJson(basePath), readJson(targetPath));
  if (extraConfigPath !== undefined) config = mergeTauriConfig(config, readJson(extraConfigPath));
  const bundle = isRecord(config.bundle) ? config.bundle : {};
  const plugins = isRecord(config.plugins) ? config.plugins : {};
  const updater = isRecord(plugins.updater) ? plugins.updater : {};
  const resources = isRecord(bundle.resources) ? bundle.resources : {};
  const targets = Array.isArray(bundle.targets) ? bundle.targets : [];
  if (JSON.stringify(targets) !== JSON.stringify([...target.bundleKinds])) {
    throw new Error(`Tauri bundle targets do not match ${target.rustTriple}`);
  }
  const resourceEntries = Object.entries(resources);
  const expectedResource = target.runtimeRelativeDir
    .replace(/^src-tauri[\\/]/u, '')
    .replace(/[\\/]+$/u, '');
  const configuredResource = resourceEntries[0]?.[0].replace(/[\\/]+$/u, '');
  if (resourceEntries.length !== 1 || resourceEntries[0][1] !== 'runtime' || configuredResource !== expectedResource) {
    throw new Error(`Tauri resources must stage the target runtime as runtime for ${target.rustTriple}`);
  }
  if (JSON.stringify(bundle.externalBin) !== JSON.stringify(['binaries/dsh-node'])) {
    throw new Error('Tauri externalBin must contain only binaries/dsh-node');
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
 * @param {string} [targetConfig=target.tauriConfig] Reviewed overlay path.
 * @param {string} [extraConfigPath] Optional later config layer.
 * @returns {string[]}
 */
export function tauriBuildArgs(target, desktopRoot, targetConfig = target.tauriConfig, extraConfigPath) {
  const args = ['--ci', '--target', target.rustTriple, '--config', resolve(desktopRoot, targetConfig)];
  if (target.rustTriple === 'x86_64-unknown-linux-gnu') args.unshift('--verbose');
  if (extraConfigPath !== undefined) args.push('--config', extraConfigPath);
  return args;
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
 * @param {Readonly<{runtimeRelativeDir: string}>} target
 * @param {string} desktopRoot
 * @returns {string}
 */
export function targetRuntimePath(target, desktopRoot) {
  return join(desktopRoot, target.runtimeRelativeDir);
}
