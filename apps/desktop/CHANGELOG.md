# Changelog

All notable changes to dsh-desktop are documented in this file. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html). The draft-release workflow copies the matching version's section into its GitHub release notes.

## [0.5.9] - 2026-09-03

### Fixed

- The installed Linux WebView smoke uses the current recorded session format, allowing the release workflow to verify the terminal card after upstream session-event changes.

## [0.5.8] - 2026-09-03

### Changed

- Integrated upstream harness master through dsh 0.1.2-alpha.5, including adjacent-agent steering, projection-cache compatibility, streamed tool-call identity fixes, and the latest session and client updates. The desktop retains its fork-owned release workflow, authenticated loopback bridge, file previews, Worktree controls, WSL Bash integration, and desktop settings.

## [0.5.7] - 2026-08-31

### Changed

- Integrated upstream harness master through dsh 0.1.2-alpha.2. The desktop now carries upstream connection recovery controls, linear stream queues, session-projection improvements, and separate turn usage and timing panels while retaining its fork-owned workflows, authenticated loopback bridge, file previews, Worktree controls, and desktop motion setting.

## [0.5.6] - 2026-08-30

### Fixed

- Worktree path insertion now appends a trailing newline so an inserted path is ready for the next composer input.
- File preview windows leave the invoking WebView IPC through Tauri's asynchronous runtime before entering the main UI loop, preventing native window creation from stalling at `about:blank`. Each new WebView exchanges the process launch token at the authenticated root before loading the preview entry, and stalled file reads resolve to a visible timeout error.
- Standalone file previews load the shared design tokens and Shiki palette with their lazy entry, so source files retain syntax highlighting outside the main application window.
- Standalone file previews now use a responsive document surface with a file header, relative path, type badge, accessible icon action, centered Markdown canvas, full-width code card, and distinct loading, refusal, and truncation states. The window follows the main window's theme (light/dark and alias-token overrides) through a shell broadcast, with the operating system preference as the browser fallback.
- Worktree path drops now insert normalized Workspace-relative paths without a leading `./`; Explorer rows use shared themed folder, file, and warning icons.
- Worktree file views now render Markdown through the shared sanitized Markdown primitive and project other text files through collision-safe language or plain-text fences.
- Explorer and Search file activation now opens or focuses a path-scoped Tauri preview window; browser runs retain the in-pane fallback.
- Desktop link activation now delegates only credential-free external HTTP(S) URLs to the platform opener; bridge, loopback, and other unsafe URLs are blocked, with a new-tab fallback in browser runs.
- Desktop context menus now classify the Lexical composer, ordinary inputs, and readable selections separately, keep one focus-restoring portal, and close deterministically on actions, navigation, viewport changes, blur, and outside input.

## [0.5.5] - 2026-08-29

### Fixed

- External file drops and worktree path drops now insert paths into the Lexical composer: the bridge previously wrote to the removed textarea, so path insertion silently failed after the editor migration. Paths re-enter through the composer's own paste pipeline (synthetic paste on `[data-composer-input]`), preserving caret and undo semantics.

## [0.5.4] - 2026-08-28

### Fixed

- The native Linux UI smoke accepts a stably absent API-key onboarding step while still requiring an appearing step to be deferred successfully.

## [0.5.3] - 2026-08-28

### Fixed

- The native Linux Tauri WebView smoke now recognizes the Lexical composer's stable `data-composer-input` element when selecting the ready application window.

## [0.5.2] - 2026-08-28

### Fixed

- The installed Linux package smoke now recognizes the Lexical composer's stable `data-composer-input` element instead of waiting for the textarea removed by the editor migration.

## [0.5.1] - 2026-08-28

### Fixed

- The browser-session redirect removes only its single-use launch token and preserves the desktop loopback bearer parameter, so packaged HTTP requests and WebSocket upgrades authenticate instead of returning 401 during startup.

## [0.5.0] - 2026-08-27

### Changed

- Version 0.5.0: integrated upstream harness master (1079 commits) into the desktop branch, advancing the hosted web profile from dsh 0.1.1-rc.2 to 0.1.2-alpha.1. The merge carries the upstream conversation split (ui-conversation → ui-chat), the browser-session authentication rework (launch-token plus signed cookie), the packed session-history transport, per-turn token usage, the lexical composer, and the thousands of commits' worth of harness features and fixes behind them; the desktop bridge keeps its loopback-token posture over the new connection architecture.

## [0.4.2] - 2026-08-26

### Fixed

- The WSL environment card now appears in Desktop settings: the bridge settings section previously rendered only the first three item slots, so the registered WSL card (item4) was invisible. The section now renders all four slots.

## [0.4.1] - 2026-08-26

### Fixed

- The runtime supervisor now degrades to direct-child ownership when the host refuses private Job Object allocation (an enclosing job without breakaway — tool hosts, sandboxed shells, CI runners), so the desktop boots instead of failing with "AssignProcessToJobObject: access denied". The degradation is never silent: the boot log records the reason and the supervisor reports containment_ok=false at termination. Termination kills the whole process tree via taskkill /T, so no runtime descendant is orphaned.

## [0.4.0] - 2026-08-26

### Added

- The runtime supervisor owns the complete desktop runtime process tree: on Windows the runtime runs inside a private Job Object configured with JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, on POSIX in its own process group. Every exit path (tray quit, ExitRequested, boot timeout, readiness disconnect, updater relaunch) funnels through the supervisor's idempotent terminate_and_join, so no owned descendant survives an abnormal runtime exit or application shutdown; close-to-tray keeps the runtime alive by design. Containment allocation failure is a fatal boot error with a diagnostic — the runtime never runs uncontained (apps/desktop/src-tauri/src/runtime_supervisor.rs).
- A target-native fixture (src-tauri/tests/runtime_tree.rs) starts a root Node process, a Node child, and a detached grandchild, prints their identities, and asserts the complete tree is terminated without process-name matching. It self-skips with an explicit reason on hosts where an enclosing job refuses private containment.
- The title-bar account summary is provider-bound: it follows the active session's model selection through a new account-summary capability (dsh-llm), so the displayed account state never lags behind the selected provider and never shows another provider's amount. The old unconditional balance endpoint was removed.
- A desktop-owned context menu replaces the production right-click suppression: Copy for selected readable text everywhere, Cut/Copy/Paste only in the conversation composer, with keyboard navigation and viewport clamping. Debug mode exposes an explicit Inspect item.
- WSL 2 discovery in Desktop settings (Windows-only): a typed readiness snapshot, distribution selection, an execution probe before enabling, and a Microsoft installation link for missing environments. The setting never installs, modifies, or downloads anything.
- An optional Bash execution world on Windows through WSL 2 (bash-wsl executor + tool-bash-wsl): PowerShell stays available, Bash joins the tool catalog only while the WSL setting is enabled and the distribution probe is healthy, working directories are Windows paths translated under /mnt, and a non-drive path fails visibly.

### Changed

- Version 0.4.0.

## [0.3.30] - 2026-08-25

### Fixed

- Packaged boots now install and refresh the desktop bridge packages in the web profile; packaged mode was previously misdetected as dev mode, so an upgrade kept a stale profile bridge that could not authenticate against the loopback token (Desktop settings, balance, and close-to-tray requests failed with HTTP 401).
- Updating the app also repairs the profile: when the desktop version or the bridge patch advances, the shell re-syncs the shell-owned bridge rows in the profile patch (preserving user rows and in-version edits), removes legacy profile residue, records the sync state, and probes the authenticated bridge route after boot so a broken bridge is logged instead of failing silently.

## [0.3.29] - 2026-08-25
### Fixed

- Desktop bridge compilation no longer fails on an unused settings-bootstrap import.

## [0.3.28] - 2026-08-25

### Fixed

- Desktop initialization captures the loopback token before client plugins load, restoring authenticated settings and balance requests.
- The title bar identifies balance-query availability instead of presenting it as chat API availability.

## [0.3.27] - 2026-08-25

### Fixed

- The Linux native UI smoke retries the transient closed-window state while the Tauri splash hands control to the main WebView.

## [0.3.26] - 2026-08-25

### Fixed

- Desktop settings validate bridge responses and persist through the authenticated loopback route without failing on an empty JSON body.
- Generic Remote RPC calls carry the desktop loopback token, restoring the plugin inventory.
- WebSocket errors and stream-open timeouts enter reconnection instead of publishing an unavailable connection as ready.

## [0.3.25] - 2026-08-25

### Fixed

- The Linux native Tauri UI smoke scopes navigation to the localized Sessions tree, ignores the provisional New Session row, and defers the fresh-home API-key prompt before opening its seeded transcript.

## [0.3.24] - 2026-08-25

### Fixed

- The Linux native Tauri UI smoke rebuilds a valid persisted-session header from its recorded fixture, acknowledges the fresh-home testing notice, and reports isolated native diagnostics on failure.

## [0.3.23] - 2026-08-25

### Fixed

- The Linux native Tauri UI smoke passes its plaintext session fixture overlay through `DSH_PATCH`, so the installed Web profile discovers the seeded transcript; failed WebDriver assertions retain a WebView screenshot.

## [0.3.22] - 2026-08-25

### Fixed

- The Windows installed-package smoke force-stops re-parented packaged sidecars by their exact installed path after the desktop shell exits.
- The Linux native Tauri UI smoke expands the sole collapsed session group before opening the seeded session.

## [0.3.21] - 2026-08-24

### Fixed

- The Linux native Tauri UI smoke accepts the seeded session whether startup has already selected it or not.

## [0.3.20] - 2026-08-24

### Fixed

- The Linux native Tauri UI smoke opens its sole persisted fixture directly from the main session tree, keeping content-index coverage in the assembled Web replay.

## [0.3.19] - 2026-08-24

### Fixed

- The Linux native Tauri UI smoke primes the cold session content index with a guaranteed miss before searching for the seeded transcript.

## [0.3.18] - 2026-08-24

### Fixed

- Linux deb and native Tauri UI smokes share a bounded command runner that accepts the baked runtime's full installed-file inventory.

## [0.3.17] - 2026-08-24

### Fixed

- The Linux deb smoke accepts the package's full installed-file inventory without exhausting Node's default synchronous child-process output buffer.

## [0.3.16] - 2026-08-24

### Fixed

- The Linux AppImage smoke launches the package's `AppRun` entry so GTK hooks and WebKit's relative helper paths use the required `$APPDIR/usr` working directory.

## [0.3.15] - 2026-08-24

### Fixed

- Linux AppImage, deb, and native UI smokes pass checkout-root absolute artifact paths so filtered pnpm scripts do not resolve them relative to `apps/desktop`.

## [0.3.14] - 2026-08-24

### Fixed

- The Linux release job restores frozen development dependencies after production runtime baking so Playwright, packaged UI, native UI, and replay smoke tooling remain available.

## [0.3.13] - 2026-08-24

### Fixed

- Linux release staging ignores Tauri's unpacked AppImage and deb work directories while retaining strict checks for unexpected files, and the macOS dmg smoke launches from a canonical temporary path so Tauri does not reject the `/var` symlink ancestor during resource lookup.

## [0.3.12] - 2026-08-24

### Fixed

- Target-owned desktop runtimes remove foreign Koffi ABI directories before packaging, preventing the Linux glibc AppImage build from treating the bundled musl addon as a deployable ELF dependency; macOS dmg smokes install outside `DSH_HOME` and retain isolated splash diagnostics on timeout.

## [0.3.11] - 2026-08-24

### Fixed

- Linux AppImage builds run on the Tauri-supported Ubuntu 22.04 baseline and expose linuxdeploy diagnostics; macOS dmg startup smokes install app bundles with native `ditto` so bundle metadata survives the copy.

## [0.3.10] - 2026-08-23

### Fixed

- Packaged startup now uses the product-owned Tauri external-binary names (`dsh-node.exe` on Windows and `dsh-node` on POSIX) while keeping target-suffixed names for source staging; package smokes launch macOS app bundles directly, use shell-native PTY marker commands, accept successful forced cleanup after a bounded graceful attempt, wait for the real NSIS uninstaller, and track only the installed sidecar path.
- Linux release bundles disable linuxdeploy stripping so prebuilt runtime and native-addon ELF files are not rewritten while the AppImage is assembled.

## [0.3.9] - 2026-08-23

### Fixed

- Reissues the cross-platform release-job fixes with a new immutable desktop release tag.

## [0.3.8] - 2026-08-23

### Fixed

- Linux AppImage packaging runs downloaded AppImage tools through their extraction mode on Ubuntu 24.04, macOS package smokes pass absolute artifact paths through pnpm's package working directory, and Windows package smokes retry temporary-directory removal while installer handles are released.

## [0.3.7] - 2026-08-23

### Fixed

- Desktop release preparation now runs consistently across Windows, Linux, and macOS: nested pnpm invocations stay shell-free, fixture paths are independent of the package working directory, POSIX permission tests update actual file modes, and Windows Node archives use argument-bound tar extraction.
- Windows runtime validation accepts Koffi's target-specific optional package, and target-owned runtime source directories use short product keys so NSIS can package deeply nested dependencies without exceeding its path limit.

## [0.3.6] - 2026-08-23

### Fixed

- Desktop bridge packages are installed as pnpm workspace members, so release runners resolve their `workspace:` dependencies without invoking npm and all target bundle jobs can compile the bridge client.

## [0.3.5] - 2026-08-23

### Added

- The Worktree Explorer and Search open files in an in-app read-only viewer: bounded strict UTF-8 content with an explicit truncation state, binary and non-UTF-8 refusal, syntax highlighting through the client's existing highlighter, and Search results that scroll to the matched line.
- The frameless main window restores native resize borders and the Windows 11 snap-layout flyout, and the maximize icon now follows window state pushed by the native host instead of click and resize events alone.

## [0.3.4] - 2026-08-21

### Fixed

- Uninstalling removes the Explorer 以 dsh-desktop 打开 context-menu entries. Because the application registers them itself, they previously survived uninstall and pointed at a deleted executable.
- Selecting Worktree while the sidebar is collapsed no longer leaves the sidebar region blank: the shared Workspace browser stays visible until the wide Worktree panel actually replaces it.
- The release version check covers Cargo.lock, which v0.3.3 shipped still recording 0.3.2, and one script now propagates the package.json version into tauri.conf.json, Cargo.toml, and Cargo.lock.
- The runtime bake resolves a relative `--dir` against the repository, so baking from another working directory can no longer plant a deploy tree beside it.

## [0.3.3] - 2026-08-20

### Fixed

- Launching the app no longer hands the served URL to the system default browser: the shell passes `--no-open` to its spawned `dsh web` runtime because the shell owns the window that shows the page.

## [0.3.2] - 2026-08-20

### Added

- An opt-in new-session Logo hover animation in the desktop settings; enabling it overrides the system reduced-motion preference for that one cue.

### Fixed

- A packaged boot leaves `DSH_BARE_MODULE_BASE` unset so profile-installed bundles stay resolvable, while the profile fallback links built-in packages back to the runtime.

## [0.3.1] - 2026-08-19

### Fixed

- The updater manifest includes the Windows architecture fallback alongside the NSIS-specific entry, so installed builds whose bundle type is unavailable can still find the signed installer.

## [0.3.0] - 2026-08-19

### Added

- A signed Windows updater checks the latest published GitHub Release, reports download progress, requires confirmation before downloading and installing, and keeps the application running when an update fails.
- The desktop shell provides workspace Explorer, search, source-control decorations, runtime status chrome, and bounded startup artwork for the web profile.

### Fixed

- The release workflow requires the updater signing key, produces the NSIS signature artifact, and publishes the matching `latest.json` manifest with the installer.

## [0.2.1] - 2026-08-17

### Added

- OS file drag-and-drop is handled by the shell (`onDragDropEvent`, real filesystem paths): dropped folders/files have their paths inserted into the composer input box, and dropped images re-enter the composer's native image intake through a bounded shell byte bridge.
- A system tray icon with a menu (显示主窗口 / 退出); the 桌面设置 section offers an explicit close-button choice between exiting and retaining the application in the tray.
- A per-user Explorer context-menu entry (以 dsh-desktop 打开) on folders; the single application instance opens the most specific owning Workspace, or asks before adding an unmatched directory as a new Workspace.

### Removed

- The bridge's copy-to-`drops/` drop pipeline and its policy rows (copy switch, size cap) — drops now put real paths into the input box instead.

### Fixed

- The dev flow installs the bridge packages by copying them from the checkout instead of `npm install` (the published @deepseek-ai manifests carry `workspace:` protocol specs npm's peer auto-install cannot resolve).
- The Explorer context-menu registration uses the full `HKCU\` root key.

## [0.2.0] - 2026-08-16

### Added

- The title bar shows the app version badge next to the title and a DeepSeek balance pill (fed by the bridge host's `/dsh-bridge/balance` route) before the window controls.

### Fixed

- The desktop flows rebuild the bridge packages from source before packing/baking (`scripts/build-bridge.mjs`), so bridge changes (e.g. the balance route) always reach dev runs and the installer; a missing bridge lib now fails the bake instead of shipping silently.
- Packaged boots keep the profile's bridge copy in lockstep with the runtime, so a stale bridge from an older install no longer survives an upgrade.
- The desktop settings (drop policy and debug mode rows) now follow the app language.
- Launching the app no longer opens a `node.exe` console window.

## [0.1.0] - 2026-08-15

### Added

- Startup splashscreen with pre-boot environment checks (WebView2, Node sidecar, runtime, data directory, API key).
- WebView2 installed at install time (`embedBootstrapper`) with a splash repair link.
- A runtime payload size gate (`pnpm --filter @deepseek-ai/dsh-desktop size-check`).
- A draft-release workflow keyed on the desktop version.

### Changed

- The packaged runtime is a production-only deploy with pruned single-platform native prebuilds, cutting the payload from ~573.8 MB to ~185.7 MB.
- The app version is single-sourced in `package.json` and synced into `tauri.conf.json` at bundle time.

### Fixed

- Packaged boot: strip the `\\?\` verbatim prefix `resource_dir()` returns (node's realpath failed on it).
- Packaged boot: merge bridge rows into the profile's empty `[]` patch instead of appending after it.
- Packaged boot: resolve the bridge packages one directory deeper than before.
