# Changelog

All notable changes to dsh-desktop are documented in this file. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html). The draft-release workflow copies the matching version's section into its GitHub release notes.

## [Unreleased]

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
