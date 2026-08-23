import { execFileSync } from 'node:child_process';
import { resolve as resolvePath } from 'node:path';

const TARGET_ROWS = [
  {
    productTarget: 'windows-x64',
    rustTriple: 'x86_64-pc-windows-msvc',
    nodePlatform: 'win',
    nodeArchitecture: 'x64',
    nodeArchiveKind: 'zip',
    nodeArchivePlatform: 'win-x64',
    sidecarSourceMember: 'node-v{version}-win-x64/node.exe',
    sidecarBasename: 'dsh-node-x86_64-pc-windows-msvc.exe',
    packagedSidecarBasename: 'dsh-node.exe',
    nativePlatformKey: 'win32-x64',
    bundleKinds: ['nsis'],
    artifactDirectories: ['src-tauri/target/{rustTriple}/release/bundle/nsis'],
    updaterPlatform: 'windows-x86_64',
    updaterArtifactSuffix: '.exe',
    updaterSignatureSuffix: '.exe.sig',
    updaterArtifactSuffixes: ['.exe', '.exe.sig'],
    tauriConfig: 'src-tauri/tauri.windows-x64.conf.json',
    runtimeRelativeDir: 'src-tauri/runtime/windows-x64',
    sizeBudgetMiB: 200,
  },
  {
    productTarget: 'linux-x64',
    rustTriple: 'x86_64-unknown-linux-gnu',
    nodePlatform: 'linux',
    nodeArchitecture: 'x64',
    nodeArchiveKind: 'tar.xz',
    nodeArchivePlatform: 'linux-x64',
    sidecarSourceMember: 'node-v{version}-linux-x64/bin/node',
    sidecarBasename: 'dsh-node-x86_64-unknown-linux-gnu',
    packagedSidecarBasename: 'dsh-node',
    nativePlatformKey: 'linux-x64',
    bundleKinds: ['appimage', 'deb'],
    artifactDirectories: [
      'src-tauri/target/{rustTriple}/release/bundle/appimage',
      'src-tauri/target/{rustTriple}/release/bundle/deb',
    ],
    updaterPlatform: 'linux-x86_64',
    updaterArtifactSuffix: '.AppImage',
    updaterSignatureSuffix: '.AppImage.sig',
    updaterArtifactSuffixes: ['.AppImage', '.AppImage.sig', '.deb', '.deb.sig'],
    tauriConfig: 'src-tauri/tauri.linux-x64.conf.json',
    runtimeRelativeDir: 'src-tauri/runtime/linux-x64',
    sizeBudgetMiB: 220,
  },
  {
    productTarget: 'macos-arm64',
    rustTriple: 'aarch64-apple-darwin',
    nodePlatform: 'darwin',
    nodeArchitecture: 'arm64',
    nodeArchiveKind: 'tar.gz',
    nodeArchivePlatform: 'darwin-arm64',
    sidecarSourceMember: 'node-v{version}-darwin-arm64/bin/node',
    sidecarBasename: 'dsh-node-aarch64-apple-darwin',
    packagedSidecarBasename: 'dsh-node',
    nativePlatformKey: 'darwin-arm64',
    bundleKinds: ['app', 'dmg'],
    artifactDirectories: [
      'src-tauri/target/{rustTriple}/release/bundle/macos',
      'src-tauri/target/{rustTriple}/release/bundle/dmg',
    ],
    updaterPlatform: 'darwin-aarch64',
    updaterArtifactSuffix: '.app.tar.gz',
    updaterSignatureSuffix: '.app.tar.gz.sig',
    updaterArtifactSuffixes: ['.app', '.app.tar.gz', '.app.tar.gz.sig', '.dmg', '.dmg.sig'],
    tauriConfig: 'src-tauri/tauri.macos-arm64.conf.json',
    runtimeRelativeDir: 'src-tauri/runtime/macos-arm64',
    sizeBudgetMiB: 220,
  },
];

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/** Immutable supported product targets keyed by their Rust target triple. */
export const SUPPORTED_TARGETS = deepFreeze(
  Object.fromEntries(TARGET_ROWS.map((row) => [row.rustTriple, row])),
);

const TARGET_TRIPLE_PATTERN = /^[a-z0-9_]+(?:-[a-z0-9_]+){2,3}$/;
const NODE_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/**
 * Resolve an explicit Rust target triple or the host triple reported by rustc.
 *
 * @param {string | undefined} requestedTriple
 * @param {{ detectHost?: () => string }} [options]
 * @returns {Readonly<{productTarget: string, rustTriple: string, nodePlatform: string, nodeArchitecture: string, nodeArchiveKind: string, nodeArchivePlatform: string, sidecarSourceMember: string, sidecarBasename: string, packagedSidecarBasename: string, nativePlatformKey: string, bundleKinds: readonly string[], artifactDirectories: readonly string[], updaterPlatform: string, updaterArtifactSuffix: string, updaterSignatureSuffix: string, updaterArtifactSuffixes: readonly string[], tauriConfig: string, runtimeRelativeDir: string, sizeBudgetMiB: number}>}
 */
export function resolveTarget(requestedTriple, options = {}) {
  const triple = requestedTriple ?? (options.detectHost ?? detectHostRustTriple)();
  if (typeof triple !== 'string' || triple.length === 0 || !TARGET_TRIPLE_PATTERN.test(triple)) {
    throw new Error(`invalid desktop target triple: ${String(triple)}`);
  }
  const target = SUPPORTED_TARGETS[triple];
  if (!target) {
    throw new Error(`unsupported desktop target triple: ${triple}`);
  }
  return target;
}

/**
 * Resolve the optional `--target` argument before a script mutates files.
 *
 * @param {readonly string[]} argv
 * @returns {Readonly<ReturnType<typeof resolveTarget>>}
 */
export function resolveTargetFromArgs(argv) {
  const index = argv.indexOf('--target');
  if (index < 0) return resolveTarget();
  const requested = argv[index + 1];
  if (!requested || requested.startsWith('-')) {
    throw new Error('--target requires a Rust target triple');
  }
  return resolveTarget(requested);
}

/**
 * Resolve target-relative artifact directories beneath the desktop package.
 *
 * @param {Readonly<{artifactDirectories: readonly string[], rustTriple: string}>} target
 * @param {string} desktopRoot
 * @returns {string[]}
 */
export function artifactDirectoriesFor(target, desktopRoot) {
  return target.artifactDirectories.map((directory) =>
    resolvePath(desktopRoot, directory.replaceAll('{rustTriple}', target.rustTriple)),
  );
}

/**
 * Render the Node archive filename and source member for a validated version.
 *
 * @param {Readonly<{nodeArchivePlatform: string, nodeArchiveKind: string, sidecarSourceMember: string}>} target
 * @param {string} version
 * @returns {{archiveName: string, sourceMember: string}}
 */
export function nodeDistributionFiles(target, version) {
  if (!NODE_VERSION_PATTERN.test(version)) {
    throw new Error(`invalid DSH_NODE_VERSION: ${version}`);
  }
  const archiveName = `node-v${version}-${target.nodeArchivePlatform}.${target.nodeArchiveKind}`;
  const sourceMember = target.sidecarSourceMember.replaceAll('{version}', version);
  assertSafeArchiveMember(sourceMember);
  return { archiveName, sourceMember };
}

/**
 * Reject archive members that could escape the extraction directory.
 *
 * @param {string} member
 * @returns {string}
 */
export function assertSafeArchiveMember(member) {
  if (
    typeof member !== 'string' ||
    member.length === 0 ||
    member.includes('\0') ||
    member.includes('\\') ||
    member.startsWith('/') ||
    /^[A-Za-z]:/.test(member) ||
    member.split('/').some((part) => part === '..' || part === '')
  ) {
    throw new Error(`unsafe archive member: ${String(member)}`);
  }
  return member;
}

/**
 * Resolve a validated archive member beneath an extraction directory.
 *
 * @param {string} extractionDir
 * @param {string} member
 * @returns {string}
 */
export function extractionPath(extractionDir, member) {
  assertSafeArchiveMember(member);
  const root = resolvePath(extractionDir);
  const path = resolvePath(root, member);
  if (path !== root && !path.startsWith(`${root}/`) && !path.startsWith(`${root}\\`)) {
    throw new Error(`archive member escaped extraction directory: ${member}`);
  }
  return path;
}

function detectHostRustTriple() {
  const output = execFileSync('rustc', ['-vV'], { encoding: 'utf8' });
  const match = output.match(/^host:\s*(\S+)$/m);
  if (!match) throw new Error('rustc -vV did not report a host target triple');
  return match[1];
}
