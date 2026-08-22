// Download and verify one official Node distribution for the selected product
// target, then copy only its executable into Tauri's externalBin directory.
// The binary and metadata are gitignored; a cache hit requires the requested
// version, target, and executable version to match.
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { get } from 'node:https';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  extractionPath,
  nodeDistributionFiles,
  resolveTargetFromArgs,
} from './target-spec.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const defaultVersion = '22.23.1';
const maxRedirects = 10;

/**
 * Download a URL to a newly created file without interpreting it as a shell
 * command. HTTP proxy support uses curl with argv-bound arguments because the
 * built-in HTTPS client does not consume proxy environment variables.
 *
 * @param {string} url
 * @param {string} destinationPath
 * @param {{request?: typeof get, proxy?: string | null}} [options]
 * @returns {Promise<void>}
 */
export async function downloadFile(
  url,
  destinationPath,
  { request = get, proxy = process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY } = {},
) {
  if (proxy !== null && proxy !== undefined) {
    new URL(proxy);
    execFileSync('curl', ['--fail', '--location', '--proxy', proxy, '--output', destinationPath, url], {
      stdio: 'inherit',
    });
    return;
  }
  await downloadHttps(url, destinationPath, 0, request);
}

/**
 * Download one HTTP response, following bounded redirects and rejecting every
 * non-success response. The destination is always a temporary path owned by
 * the caller, so a failed transfer cannot become a valid cache entry.
 *
 * @param {string} url
 * @param {string} destinationPath
 * @param {number} redirectCount
 * @param {typeof get} requestUrl
 * @returns {Promise<void>}
 */
async function downloadHttps(url, destinationPath, redirectCount, requestUrl) {
  await new Promise((resolveDone, reject) => {
    const request = requestUrl(url, (response) => {
      const location = response.headers.location;
      if (location && response.statusCode >= 300 && response.statusCode < 400) {
        response.resume();
        if (redirectCount >= maxRedirects) {
          reject(new Error(`Node archive request exceeded ${maxRedirects} redirects`));
          return;
        }
        downloadHttps(new URL(location, url).toString(), destinationPath, redirectCount + 1, requestUrl)
          .then(resolveDone, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Node archive request failed with HTTP ${response.statusCode}`));
        return;
      }
      const output = createWriteStream(destinationPath, { flags: 'wx' });
      response.pipe(output);
      output.on('finish', () => output.close(resolveDone));
      output.on('error', reject);
      response.on('error', reject);
    });
    request.on('error', reject);
  });
}

/**
 * Extract an official Node archive using host-native argv-based tools.
 *
 * @param {string} archivePath
 * @param {string} extractDir
 * @param {Readonly<{nodeArchiveKind: string}>} target
 * @param {string} hostPlatform
 * @returns {void}
 */
export function extractArchive(archivePath, extractDir, target, hostPlatform = process.platform) {
  mkdirSync(extractDir, { recursive: true });
  if (target.nodeArchiveKind === 'zip') {
    if (hostPlatform === 'win32') {
      execFileSync('powershell', [
        '-NoProfile',
        '-Command',
        'Expand-Archive -LiteralPath $args[0] -DestinationPath $args[1] -Force',
        archivePath,
        extractDir,
      ], { stdio: 'inherit' });
    } else {
      execFileSync('unzip', ['-q', archivePath, '-d', extractDir], { stdio: 'inherit' });
    }
    return;
  }
  const flag = target.nodeArchiveKind === 'tar.xz' ? '-xJf' : '-xzf';
  execFileSync('tar', [flag, archivePath, '-C', extractDir], { stdio: 'inherit' });
}

/**
 * Find the checksum for one exact archive filename in Node's SHASUMS file.
 *
 * @param {string} checksumText
 * @param {string} archiveName
 * @returns {string}
 */
export function checksumForArchive(checksumText, archiveName) {
  for (const line of checksumText.split(/\r?\n/)) {
    const match = line.trim().match(/^([a-fA-F0-9]{64})\s+[* ]?(.+)$/);
    if (match?.[2] === archiveName) return match[1].toLowerCase();
  }
  throw new Error(`Node SHASUMS256.txt has no entry for ${archiveName}`);
}

/**
 * Verify a file against a SHA-256 digest from the matching Node release.
 *
 * @param {string} filePath
 * @param {string} expected
 * @returns {void}
 */
export function verifySha256(filePath, expected) {
  const actual = createHash('sha256').update(readFileSync(filePath)).digest('hex');
  if (actual !== expected.toLowerCase()) {
    throw new Error(`SHA-256 mismatch for ${filePath}: expected ${expected}, got ${actual}`);
  }
}

/**
 * Read the executable version without allowing a failed process to count as a
 * cache hit.
 *
 * @param {string} filePath
 * @returns {string}
 */
export function executableVersion(filePath) {
  const result = spawnSync(filePath, ['--version'], { encoding: 'utf8' });
  if (result.status !== 0) return '';
  return (result.stdout ?? '').trim();
}

/**
 * Fetch, verify, extract, and install one target-owned Node sidecar.
 *
 * @param {object} options
 * @param {Readonly<object>} options.target
 * @param {string} options.version
 * @param {string} options.destination
 * @param {string} options.metadataPath
 * @param {(url: string, destinationPath: string) => Promise<void>} [options.download]
 * @param {(archivePath: string, extractDir: string, target: Readonly<object>) => void} [options.extract]
 * @param {(filePath: string) => string} [options.readVersion]
 * @param {() => string} [options.createTemporaryRoot]
 * @param {(filePath: string, mode: number) => void} [options.setExecutable]
 * @param {string} [options.hostPlatform]
 * @returns {Promise<{destination: string, sha256: string, cached: boolean}>}
 */
export async function fetchNodeSidecar({
  target,
  version,
  destination,
  metadataPath,
  download = downloadFile,
  extract = (archivePath, extractDir, selectedTarget) => extractArchive(
    archivePath,
    extractDir,
    selectedTarget,
  ),
  readVersion = executableVersion,
  createTemporaryRoot = () => mkdtempSync(join(tmpdir(), 'dsh-node-')),
  setExecutable = chmodSync,
  hostPlatform = process.platform,
}) {
  const { archiveName, sourceMember } = nodeDistributionFiles(target, version);
  const archiveUrl = `https://nodejs.org/dist/v${version}/${archiveName}`;
  const checksumUrl = `https://nodejs.org/dist/v${version}/SHASUMS256.txt`;

  if (cachedSidecarMatches(destination, metadataPath, target, version, readVersion)) {
    const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
    return { destination, sha256: metadata.sha256, cached: true };
  }

  const temporaryRoot = createTemporaryRoot();
  const archivePath = join(temporaryRoot, archiveName);
  const checksumPath = join(temporaryRoot, 'SHASUMS256.txt');
  const extractDir = join(temporaryRoot, 'extract');
  try {
    console.log(`[fetch-node-sidecar] downloading ${archiveUrl}`);
    await download(archiveUrl, archivePath);
    await download(checksumUrl, checksumPath);
    const sha256 = checksumForArchive(readFileSync(checksumPath, 'utf8'), archiveName);
    verifySha256(archivePath, sha256);
    extract(archivePath, extractDir, target);

    const sourcePath = extractionPath(extractDir, sourceMember);
    if (!existsSync(sourcePath) || !statSync(sourcePath).isFile()) {
      throw new Error(`Node executable not found in archive: ${sourceMember}`);
    }
    const stagedDestination = join(temporaryRoot, target.sidecarBasename);
    copyFileSync(sourcePath, stagedDestination);
    if (hostPlatform !== 'win32') setExecutable(stagedDestination, 0o755);
    if (readVersion(stagedDestination) !== `v${version}`) {
      throw new Error(`Node sidecar reported an unexpected version; expected v${version}`);
    }

    mkdirSync(dirname(destination), { recursive: true });
    rmSync(destination, { force: true });
    rmSync(metadataPath, { force: true });
    copyFileSync(stagedDestination, destination);
    if (hostPlatform !== 'win32') setExecutable(destination, 0o755);
    writeFileSync(metadataPath, `${JSON.stringify({
      archiveName,
      sha256,
      version,
      rustTriple: target.rustTriple,
    }, null, 2)}\n`);
    console.log(`[fetch-node-sidecar] sidecar at ${destination}`);
    return { destination, sha256, cached: false };
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function cachedSidecarMatches(destination, metadataPath, target, version, readVersion) {
  if (!existsSync(destination) || !existsSync(metadataPath)) return false;
  try {
    const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
    return metadata.version === version
      && metadata.rustTriple === target.rustTriple
      && typeof metadata.sha256 === 'string'
      && readVersion(destination) === `v${version}`;
  } catch {
    return false;
  }
}

async function main() {
  const target = resolveTargetFromArgs(process.argv.slice(2));
  const version = process.env.DSH_NODE_VERSION ?? defaultVersion;
  const destination = resolve(here, '../src-tauri/binaries', target.sidecarBasename);
  const metadataPath = `${destination}.meta.json`;
  await fetchNodeSidecar({ target, version, destination, metadataPath });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`[fetch-node-sidecar] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
