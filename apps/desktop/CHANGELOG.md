# Changelog

All notable changes to dsh-desktop are documented in this file. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html). The draft-release workflow copies the matching version's section into its GitHub release notes.

## [Unreleased]

## [0.3.0] - Unreleased

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
