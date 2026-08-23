# Agent Note: Desktop multi-platform implementation plan

Status: proposed

English | [中文](2026-08-22-desktop-multiplatform-support-plan.zh.md)

## Problem

The desktop application ships only a Windows x64 NSIS installer. The source contains several independent Windows assumptions: the Node sidecar downloader selects a Windows zip and writes `node-x86_64-pc-windows-msvc.exe`; the runtime bake retains only `win32-x64` native files; packaged startup searches for `node.exe`; WebView2 commands and status text are not isolated from other webview implementations; the Tauri bundle config selects NSIS and its hooks; size reporting searches only the NSIS output; and the release workflow owns one `windows-latest` build. Replacing the bundle target alone would therefore produce an artifact whose runtime or native shell can fail after installation.

An implementation agent needs an ordered plan that separates portable mechanisms from platform policy, proves the packaged application rather than only a development launch, and does not silently weaken Windows while adding Linux and macOS.

## Proposal

### Scope and release order

The first new supported target is **Linux x64** (`x86_64-unknown-linux-gnu`), delivered as an AppImage and `.deb`. The second is **macOS arm64** (`aarch64-apple-darwin`), delivered as a signed and notarized `.app`/`.dmg` plus the updater artifact required by Tauri. Windows x64 remains supported throughout. Additional architectures and Linux package formats require a later decision backed by native-dependency and runner evidence; an agent must not add them by extending a matrix speculatively.

Linux work starts only after the assembled headless/web profile can complete its existing build, boot, and terminal smoke on a Linux host. Desktop work may repair a packaging-only failure under `apps/desktop`; a failure in a package under `packages/` belongs to the owning capability and must be completed and verified there before this plan resumes. macOS work starts after the Linux release path is green, because signing, notarization, app-bundle placement, and updater signatures add a separate release trust chain.

This plan covers build, packaging, release automation, installation and update verification, platform-specific shell behavior, documentation, and evidence. It does not promise feature parity for OS integrations that have no equivalent: Explorer context-menu registration and the Windows 11 snap-layout treatment remain Windows-only. The portable contract is that every supported artifact boots its bundled runtime, reaches the readiness line, opens the main UI, runs a terminal command, shuts down the managed runtime, and can be updated through its platform's supported Tauri path.

## Required implementation sequence

Each work package ends in a reviewable commit or PR. Do not begin a later package while an earlier package's focused checks are red. Preserve unrelated working-tree changes, and follow the repository's pre-push check selection before publishing a branch.

### 1. Record the target model and make platform selection explicit

Add one small shared module under `apps/desktop/scripts/` that resolves a supported build target into an immutable specification. Its input is an explicit Rust target triple supplied by the caller or the current host triple detected by a command with validated output. Its output names at least: Tauri target triple, Node distribution platform and architecture, archive kind, sidecar source member, sidecar destination basename, runtime native-platform key, bundle kinds, artifact directories, and updater artifact suffixes.

Support exactly these rows at first:

| Product target | Rust triple | Node distribution | Sidecar filename stem | Bundles |
|---|---|---|---|---|
| Windows x64 | `x86_64-pc-windows-msvc` | `win-x64.zip` | `node-x86_64-pc-windows-msvc.exe` | NSIS |
| Linux x64 | `x86_64-unknown-linux-gnu` | `linux-x64.tar.xz` | `node-x86_64-unknown-linux-gnu` | AppImage, deb |
| macOS arm64 | `aarch64-apple-darwin` | `darwin-arm64.tar.gz` | `node-aarch64-apple-darwin` | app, dmg |

Reject an absent, malformed, or unsupported target before downloading, deleting, baking, or bundling. Do not infer the product target from `process.platform` inside individual scripts: release jobs may cross-compile preparatory assets, and duplicated inference is how the sidecar, native runtime, and bundle drift apart. Keep the Node version in one existing configuration point and retain `DSH_NODE_VERSION` as the deliberate override.

Add Node tests that pin every field in all three rows, reject unsupported architectures, and prove that archive members cannot escape the temporary extraction directory. The target resolver is complete when the sidecar fetcher, runtime bake, size report, and bundle command all consume it and no owned script retains a `win32-x64`, Windows target triple, or NSIS output path outside the target table or explicitly Windows-only behavior.

### 2. Make Node sidecar acquisition portable and reproducible

Refactor `fetch-node-sidecar.mjs` around the target specification. Download the official Node archive for the selected version and target, follow redirects, reject non-success HTTP responses, write into a newly created temporary directory, extract with argv-based tools appropriate to the host, locate exactly the specified Node binary, copy it to Tauri's `externalBin` target name, and set executable permission on POSIX. Clean temporary files in `finally`; a failed download or extraction must not leave a partial destination that a later run treats as valid.

Do not trust existence alone for cache reuse. Record or verify the selected Node version and target beside the binary, and run `<sidecar> --version`; a mismatch forces a fresh download. CI must verify the archive with the `SHASUMS256.txt` published for the same Node release before extraction. Proxy support must work without shell interpolation and must preserve the existing `HTTPS_PROXY`/`HTTP_PROXY` behavior.

Unit tests use local fixture archives or an injected download/extract adapter; they cover redirects, HTTP failure, checksum mismatch, corrupt archive, missing archive member, POSIX executable mode, stale cached metadata, and exact destination names. A host smoke runs the fetched sidecar's `--version`. Never commit downloaded sidecars.

### 3. Bake one runtime for one target

Replace `bake-runtime.mjs`'s `TARGET_TRIPLE = 'win32-x64'` policy with the target specification. A runtime directory is target-owned, such as `.runtime/<rust-triple>/deploy`, so parallel matrix jobs and local switching cannot reuse native files from another platform. The Tauri resource staging step must select only the current target's directory.

Run the bake on the target operating system. `pnpm deploy` installs host-native dependencies, and `node-pty` may compile during install; do not copy a runtime baked on Windows into Linux or macOS. On Linux, install the compiler, Python, `make`, and development libraries required by `node-pty` and the Tauri webview stack, and force a source build only when the installed package has no compatible prebuild. Reuse the repository's existing manylinux `node-pty` build knowledge where applicable, but do not claim manylinux portability for an AppImage until the installed artifact has been tested on the declared minimum distribution.

Generalize native pruning from a Windows constant into an allowlist derived from the target. Inspect every shipped `.node`, executable helper, and prebuild directory in `node-pty`, `koffi`, and other native dependencies. Fail if the runtime contains a native binary for a different OS/architecture or if a required current-target binary is absent. Preserve licenses and runtime JavaScript; do not delete source files merely because their names look build-related unless the existing size policy owns that deletion.

Boot verification must invoke the fetched sidecar for the selected target, not ambient `node`, against the target runtime and a scratch `DSH_HOME`, then require the readiness line and terminate the process tree. Add script tests for target-specific directory selection and pruning, plus a Linux CI smoke that opens a terminal through the assembled profile. This work package is complete only when a clean Linux runner can bake offline-installable runtime bytes and the packaged sidecar can boot them.

### 4. Split portable shell behavior from OS integrations

Make `apps/desktop/src-tauri/src/main.rs` compile and behave deliberately on all three targets.

- Resolve the packaged sidecar through Tauri's sidecar/resource facilities or a platform basename helper; never append `node.exe` on POSIX. Require the packaged binary to exist and report a fatal startup error instead of falling back to ambient `node` in a release build.
- Put WebView2 controller access, the WebView2 repair command, Explorer registry writes, installer-hook assumptions, and Windows chrome code behind `#[cfg(windows)]`. Supply a portable debug-mode implementation for Linux/macOS using Tauri APIs where available; if a platform cannot disable developer tools at runtime, make the limitation explicit in the returned status and documentation instead of compiling a no-op that claims success.
- Give splash checks platform-neutral identifiers and messages. Windows may render a WebView2-specific repair action; Linux reports WebKitGTK/runtime-library failures through packaging prerequisites; macOS relies on the system WebKit and must not offer the Microsoft repair URL.
- Keep file-drop, single-instance path delivery, tray, close-to-tray, workload sampling, loopback token propagation, runtime shutdown, and readiness navigation portable. Add cfg-specific adapters only where the underlying Tauri API differs.
- Define intentional OS integration parity: Windows keeps Explorer registration and snap-layout support; Linux and macOS accept a directory passed on the command line and through second-instance activation. Finder and desktop-environment context-menu installers remain out of scope until separately designed.

Move platform-specific logic into small modules if `cfg` branches would obscure portable lifecycle code. Rust tests cover sidecar path resolution, platform-neutral splash state, runtime command construction, and shutdown behavior. Run `cargo check --target` natively on each supported runner; cross-checking from Windows is not evidence for WebKitGTK or macOS framework linkage.

### 5. Make Tauri configuration and local commands target-aware

Replace the single NSIS-only configuration with a portable base plus target-specific configuration files or a generated, validated configuration passed to `tauri build`. Keep window definitions, resources, icons, updater public key, and portable plugins in the base. Keep WebView2 bootstrapper, NSIS hooks, passive update mode, and Windows bundle settings in the Windows layer. Linux selects AppImage and deb. macOS selects app and dmg, declares the minimum supported macOS version, category, entitlements, hardened runtime, signing identity inputs, and app-bundle resources required by Node and native helpers.

Do not let generation create an unreviewed configuration in place. A check mode must render each target deterministically and compare or validate its effective JSON. `bundle` accepts an explicit target, runs version sync, bridge build, target runtime bake, target sidecar fetch, focused tests, size check, and `tauri build --target <triple>` with the matching configuration. A missing signing secret may skip only the signing/notarization step in a documented local development command; the release command fails loud.

Update `size-report.mjs` to accept the same target, inspect the target runtime, locate every expected bundle type, and apply a recorded per-target budget. Report runtime bytes separately from compressed installer bytes because AppImage, deb, NSIS, and dmg compression are not comparable. Add tests for artifact discovery and a failure when any expected artifact is absent.

### 6. Build a target-native release matrix without weakening tag validation

Preserve the existing tag-gated entry and immutable-source rule. Split `.github/workflows/desktop-release.yml` into a lightweight validation job and target-native build jobs for `windows-latest`, `ubuntu-24.04`, and `macos-14` (or their current pinned equivalents). Validation checks the `v<package version>` tag and Changelog once, then exports the exact version and commit used by every build.

Each build installs only its target prerequisites, builds the repository and bridge packages, bakes its own runtime, fetches and verifies its own sidecar, runs focused target smokes, creates bundles, runs the target size check, and uploads named artifacts containing the version, OS, and architecture. Do not pass baked runtime directories between operating systems. The release job downloads all expected artifacts, rejects missing or duplicate names, records SHA-256 hashes, creates or refreshes only the draft Release for the validated tag, and never mutates a published Release.

Linux artifacts are built on the oldest supported glibc/WebKitGTK baseline or tested on that baseline before publication. The AppImage smoke runs under a virtual display when a graphical runner is unavailable and must prove readiness plus one terminal command through the packaged runtime. The deb smoke installs into a disposable runner or container, verifies desktop metadata and executable placement, launches the installed app, and uninstalls it.

macOS release jobs import the Developer ID certificate into a temporary keychain, sign the app and every nested executable/native helper, submit for notarization, staple the result where supported, verify with `codesign --verify --deep --strict` and `spctl`, and remove the temporary keychain in an always-run cleanup step. Store the certificate, password, Apple credentials, team id, and Tauri updater private key only as repository/environment secrets. Logs and artifacts must not contain decoded credentials. If those secrets are unavailable, macOS remains a build-only experimental artifact and must not be added to the supported download list.

Extend `scripts/ci-workflow.spec.ts` to pin the three target jobs, target-native runtime bake, prerequisite isolation, tag/version propagation, signing cleanup, artifact completeness, hash generation, draft-only publication, and the absence of any branch-triggered release. These structural tests supplement, not replace, real workflow runs.

### 7. Define updater manifests per platform

Tauri updater selection depends on platform and architecture. Generate `latest.json` from the artifacts created in the same validated workflow, with one entry for each actually supported updater target, its download URL, updater signature, version, and release notes. Never point Linux or macOS entries at an NSIS asset, and never publish a manifest entry for an unsigned or unnotarized artifact.

Use the existing updater public key in the application and the protected private key only in release jobs. Verify every generated signature before uploading the manifest. Test manifest generation with fixture artifact inventories covering all supported rows, a missing signature, duplicate target, wrong version, and an unexpected filename. Perform an installed-version update smoke on each OS: install version N, publish or serve a signed N+1 fixture through a controlled endpoint, confirm detection, require the existing user confirmations, complete installation, relaunch, and assert the running version is N+1 with the profile and Workspace data preserved.

Platform installers have different replacement and uninstall behavior. Keep Windows NSIS hook coverage for Explorer keys; Linux and macOS tests verify only files and integrations their packages own. An uninstaller must never remove `DSH_HOME` or user Workspaces.

### 8. Verify product behavior and document support

Update `apps/desktop/README.md` and its Chinese counterpart in the same change that each platform becomes supported. State the supported OS version/architecture, package formats, required system libraries, install/upgrade/uninstall commands, signing status, artifact verification, platform-specific missing integrations, development prerequisites, target-aware bundle commands, and troubleshooting paths. Remove Windows-only statements from portable sections; retain them under a Windows heading.

For each target, retain this evidence from a clean installed artifact, not `cargo run`:

1. installer/package verification and successful installation;
2. first launch, splash checks, readiness navigation, and main-window display;
3. API-key warning without a key and normal configuration persistence;
4. Workspace registration and opening a file from Explorer/Search;
5. one terminal command with output and clean terminal disposal;
6. close-to-tray and explicit exit with no surviving bundled Node process;
7. second-instance directory delivery;
8. update from the previous supported version;
9. uninstall with `DSH_HOME` retained;
10. a GIF recorded from the real packaged application for the user-visible flow.

Use focused automated tests for deterministic behavior, native-host integration tests for shell/runtime wiring, and target-native packaged smokes for installation. A manual checklist alone is insufficient; GUI automation alone is insufficient for process cleanup and updater signatures. Record commands actually run and link the resulting implemented Agent Note when the platform ships.

## Current progress

Work package 1 is implemented in [the desktop target specification note](../../implemented/feature/2026-08-22-desktop-target-specification.md). The three target rows are immutable and are consumed by sidecar acquisition, runtime baking, size reporting, and bundle orchestration; target-specific tests cover all row fields, unsupported targets, Node archive layouts, and archive path traversal.

Work package 2 is implemented in [the portable Node sidecar note](../../implemented/feature/2026-08-22-desktop-portable-node-sidecar.md). Sidecar acquisition selects the target archive, follows bounded redirects, rejects HTTP failures, verifies the matching `SHASUMS256.txt` digest before extraction, records version/target/digest metadata, checks the executable version, sets POSIX permissions, replaces the sidecar and metadata with a recoverable swap, preserves the prior destination if installation or the final mode check fails, and cleans its temporary files. Injected-adapter tests cover checksum mismatch, corrupt archives, missing members, stale metadata, exact destination names, redirects, HTTP failures, cleanup, executable-mode requests, and replacement rollback. Target-owned runtime directories and target-derived native pruning are wired; native target-runner boot evidence remains part of work package 3.

The runtime-bake path now requires the fetched target sidecar for profile initialization and readiness verification, terminates the verification process tree, and runs the sidecar fetch before baking in the bundle command. [Target-native runtime validation](../../implemented/feature/2026-08-22-desktop-target-native-runtime.md) prunes every native `prebuilds` directory, accepts a target source build when no compatible prebuild exists, requires loadable `node-pty` and `koffi` binaries when present, and rejects detectable foreign-platform native files before boot verification. Focused tests cover compatible prebuilds, source-build fallback, missing target binaries, and foreign files. The Rust shell has target-specific packaged sidecar basenames, refuses ambient Node for packaged startup, isolates WebView2 controller and repair code to Windows, and reports a platform-neutral `webview` splash step. The portable debug-mode command returns `{ requested, applied, limitation }`; Linux and macOS report `applied: false` with an explicit platform-webview limitation, and the bridge client records that limitation. Work package 3 remains open until target-native boot and Linux terminal evidence pass; work package 4 remains open until all supported targets compile and exercise their portable shell behavior on native runners.

[Target-aware bundle configuration and updater inventory](../../implemented/feature/2026-08-22-desktop-target-aware-bundles.md) now separates shared Tauri settings from reviewed Windows, Linux, and macOS layers. Bundle orchestration validates the effective target layer, target output directories include the Rust triple, size reporting checks every expected artifact and reports compressed installer bytes separately, and updater manifest generation reads the shared Tauri updater public key and verifies each primary artifact's Minisign file and trusted comment signatures before writing the manifest. Tests cover valid signatures, changed artifacts, public-key mismatch, and signed primary artifacts for all three rows. Work package 5, the Windows/Linux draft artifact staging portion of work package 6, and the manifest-generation portion of work package 7 are implemented; target-native installation, update, uninstall, and packaged GUI evidence remain open.

The Linux release job now runs a target-native AppImage startup smoke and a deb install/start/purge smoke under `xvfb-run`. It also invokes the [Linux baseline preflight](../../implemented/feature/2026-08-22-desktop-linux-baseline-preflight.md), which records the runner's glibc, GTK, WebKitGTK, and packaging-tool versions after prerequisite installation. The smoke proves packaged readiness, managed-process cleanup, and temporary `DSH_HOME` retention; terminal interaction, updater installation, minimum-distribution coverage, and packaged GUI evidence remain open. The preflight records the build environment but does not establish compatibility with older distributions.

The Linux baseline preflight accepts `--output <file>` and the release job uploads its target, library, and packaging-tool record as a versioned evidence artifact separate from the installable release inventory. [The baseline artifact note](../../implemented/testing/2026-08-23-desktop-linux-baseline-artifact.md) records this evidence-retention mechanism; it does not close minimum-distribution support.

The packaged smoke creates a user-data marker before launch and requires the marker and `DSH_HOME` to survive deb purge. This closes the package-smoke check for user-data retention without claiming that an installed version-N to version-N+1 update has been verified. The [desktop Linux packaged smoke note](../../implemented/feature/2026-08-22-desktop-linux-packaged-smoke.md) records the mechanism and its remaining evidence boundary.

The packaged smoke now preserves command lines in its POSIX process snapshots, identifies the target-named Node sidecar after re-parenting, and bounds graceful shutdown before a `SIGKILL` cleanup attempt. [Desktop packaged process cleanup verification](../../implemented/bug-fix/2026-08-22-desktop-packaged-process-cleanup.md) records this check; it strengthens process-cleanup evidence without closing the remaining native-platform acceptance work.

The packaged smoke now also accepts `--terminal-smoke`. After launching an AppImage, deb, app, or dmg artifact, it resolves exactly one target sidecar and runtime from the package and uses that runtime to execute a fixed `printf` probe through `node-pty`, then waits for probe exit and performs target-local cleanup. The Linux and macOS workflow jobs invoke this check. [Desktop packaged terminal smoke](../../implemented/testing/2026-08-22-desktop-packaged-terminal-smoke.md) records the evidence and its limit: this proves packaged PTY bytes and disposal, not the browser/model-facing terminal workflow.

The deb installation smoke queries the package-manager file list after installation, launches the executable registered by `dpkg`, and runs its optional terminal probe against the installed target sidecar and runtime. [Desktop deb installed-runtime smoke](../../implemented/bug-fix/2026-08-23-desktop-deb-installed-runtime-smoke.md) records this path-selection fix; native Linux installation, terminal UI, update, uninstall, baseline, and GUI evidence remain open.

The macOS arm64 workflow retains its unsigned experimental job and also has an opt-in signed release lane controlled by `DSH_DESKTOP_MACOS_RELEASE=true`. The signed lane imports the Developer ID certificate into a temporary keychain, passes `APPLE_SIGNING_IDENTITY` to Tauri before bundle and updater generation, verifies nested code with `codesign`, submits the dmg to `notarytool`, staples the app and dmg, checks the app with `spctl`, recreates the updater archive from the stapled app, and re-signs that archive with the protected Tauri key. An always-run cleanup restores the runner keychain list and removes temporary key material. A separate attachment job adds only the signed macOS inventory and refreshed `latest.json`/`SHA256SUMS` to the draft Release; the experimental inventory never enters the manifest. This lane provides release automation, not macOS support evidence.

The target-native packaged smoke accepts macOS arm64 app and dmg artifacts. Both the unsigned experimental job and the opt-in signed job launch the app bundle on `macos-14`; the dmg path mounts, copies, detaches, and launches the app before checking readiness and managed-process cleanup. This is packaged-startup evidence only; macOS update, uninstall, notarization/Gatekeeper, and GUI evidence remain open.

The Windows x64 release job now runs the [Windows installed-package smoke](../../implemented/testing/2026-08-22-desktop-windows-packaged-smoke.md) after size and artifact checks and before upload. It installs the NSIS artifact into a disposable directory, launches the installed shell, optionally runs the packaged PTY probe, verifies managed-process cleanup, runs the uninstaller, and checks temporary user data retention. The workflow and script tests cover the mechanism; native Windows runner execution remains the evidence source.

The updater manifest generator now accepts `--download-base-url` for controlled update fixtures, `bundle` accepts `--updater-endpoint` to embed a runner-local endpoint in a temporary Tauri configuration layer, and `update-fixture` validates the selected next-version artifact and serves a target-only signed manifest and artifact from loopback. These options validate the endpoint without changing the production GitHub URL; [the controlled manifest URL note](../../implemented/testing/2026-08-22-desktop-update-smoke-manifest-base.md), [the endpoint injection note](../../implemented/testing/2026-08-22-desktop-update-smoke-endpoint-injection.md), and [the update fixture server note](../../implemented/testing/2026-08-22-desktop-update-fixture-server.md) record the mechanisms. [The installed update smoke](../../implemented/testing/2026-08-23-desktop-installed-update-smoke.md) now drives the existing updater control and confirmation calls, records the version transition across restart, stops the restarted package process, checks user-data retention when invoked with `--update-smoke --expected-version <next-version>`, and provides a fixed-port coordinator for target-native execution. Target-native execution against a version-N package and signed version-N+1 artifact remains open.

Remaining work is the target-native Linux terminal UI/model-facing workflow, installed-update runner evidence, minimum-baseline, and packaged GUI evidence; macOS credentialed execution of the opt-in signing lane, notarization/Gatekeeper evidence, installed-update runner evidence, supported-release documentation, and GUI evidence; and native Windows runner execution of the installed-package regression. The update smoke driver, signed-lane automation, manifest signature verification, and packaged PTY smoke do not replace target-native installed-version update execution or user-visible GUI evidence.

The current Windows checkout passes the desktop script tests (53 tests), desktop frontend tests (58 tests), Tauri Rust tests (6 tests), the desktop release workflow structure test, the named bilingual-pair checks, and Agent Note format validation. `pnpm run doc-sync` passes all 28 gates, including the documentation build.

The release product remains Windows x64 only. Linux and macOS are not supported until their native runtime, Rust/Tauri shell, target configuration, release workflow, updater, installation, update, uninstall, and packaged GUI evidence satisfy the acceptance criteria below.

## Pull-request partition

Keep these changes reviewable in this dependency order:

1. target specification and script tests;
2. portable sidecar acquisition;
3. target-owned runtime bake and native validation;
4. Rust platform isolation and native checks;
5. target-aware Tauri configuration, bundle command, and size reporting;
6. Linux release job, installer smokes, updater row, docs, and GUI evidence;
7. macOS build with unsigned local smoke;
8. macOS signing, notarization, updater row, installed-update smoke, docs, and GUI evidence.

If these are stacked PRs, use the repository's official stacked-PR workflow. Fix defects in the PR that introduces the affected mechanism before propagating the stack. A later PR must not carry a compatibility shim for an earlier branch in this pre-release repository.

## Acceptance criteria

Linux support is complete only when a tag-gated workflow produces versioned x64 AppImage and deb artifacts from the validated tag; checks their native runtime and size; installs and boots them on the declared baseline; reaches readiness; opens a terminal session; exits without a surviving runtime; verifies update and uninstall data retention; publishes correct updater metadata; and includes current bilingual documentation plus real packaged GUI evidence.

macOS support is complete only when the same properties hold for arm64 and the released app is Developer ID signed, notarized, stapled where applicable, accepted by Gatekeeper verification, and represented by a verified updater signature. An unsigned `.app` built in CI proves compilation only and must remain experimental.

The multi-platform phase is complete when Windows x64, Linux x64, and macOS arm64 are built from one validated tag without sharing native runtime bytes; every release contains hashes and the exact expected artifact set; the updater selects the correct signed artifact; supported-platform documentation matches the published assets; focused script/Rust/workflow tests pass; target-native packaged smokes pass; `pnpm run doc-sync` passes; bilingual pair records are current; and the Windows installer, Explorer integration, snap layout, and update flow retain their existing evidence.

## Alternatives considered

**Ship Linux and macOS in one release.** Rejected because macOS adds a signing, notarization, app-bundle, and updater trust chain that does not validate Linux mechanisms. Linux provides the first complete proof that target selection, POSIX sidecars, native runtime baking, non-NSIS bundles, and a target-native release matrix work before credentials become part of the failure space.

**Cross-build every artifact from Windows.** Rejected because `pnpm deploy`, `node-pty`, `koffi`, WebKitGTK, macOS frameworks, package installers, and platform signing consume target-native tools or bytes. Cross-compilation can check portable source but cannot prove the installed runtime.

**Use ambient Node on POSIX instead of a sidecar.** Rejected because it would make Linux and macOS artifacts depend on an unversioned external runtime while Windows stays self-contained. The product requires one versioned, offline-bootable runtime on every supported platform.

**Publish unsigned macOS builds with installation instructions that bypass Gatekeeper.** Rejected because bypass instructions move the release trust decision to users and do not support a safe updater path. Unsigned builds remain compilation evidence only.

## Risks

- A native dependency that cannot build or run on the declared baseline stops that platform. Do not suppress the feature, replace the terminal with a fake implementation, or publish a partial artifact; repair the owning capability or revise the supported baseline through a recorded product decision.
- Linux AppImage portability is constrained by glibc, WebKitGTK, FUSE, and native addon linkage. Evidence from the hosted runner alone does not establish the minimum distribution.
- macOS publication is blocked without product-owned Apple credentials and updater signing secrets. An agent may implement and test the unsigned build path but cannot declare support or invent credential handling.
- A Tauri configuration or updater change that regresses Windows stops the phase. Multi-platform support adds target policy; it does not replace existing platform-specific behavior with the lowest common denominator.
- Any bundle that falls back to ambient Node, loads native bytes for another target, omits updater verification, or deletes user data on uninstall is a release blocker.
