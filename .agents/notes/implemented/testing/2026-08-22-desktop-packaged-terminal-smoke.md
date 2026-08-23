# Agent Note: Desktop packaged terminal smoke

Status: implemented

English | [中文](2026-08-22-desktop-packaged-terminal-smoke.zh.md)

## Problem

Desktop package startup can succeed while the target runtime omits or cannot load the native PTY dependency used by terminal features. A host-side terminal test does not inspect the resources staged into an AppImage, deb, or macOS app bundle.

## Decision

The target-native packaged smoke extracts or stages the artifact, launches the installed desktop executable, waits for its readiness URL, and then resolves exactly one Tauri-installed Node sidecar and one `lib/bin.js` runtime from the installed package. The sidecar runs a fixed marker command through the runtime's `node-pty` module, using `echo` under Windows `cmd.exe` and `printf` under the POSIX shell. It requires the marker in PTY output, waits for the probe process to exit, and retains the existing desktop process-tree cleanup check.

The deb path installs the artifact, queries its registered file list, and resolves the `/usr/bin` sidecar and resource runtime independently from that package-owned list. The macOS dmg path copies the mounted app before launching it, while a direct app artifact is launched through `Contents/MacOS/dsh-desktop` without treating the `.app` directory as an executable. Symlinks are ignored during extracted-package resource discovery, and missing or duplicate sidecars and runtimes fail the smoke.

This check proves target-native packaged PTY bytes and disposal. It does not claim that a browser session invoked a model-facing terminal tool; that GUI and updater evidence remains an installed-product requirement.

## Alternatives considered

**Run the terminal command with the host Node.** Rejected because the host executable and native addons can differ from the bytes shipped in the installer.

**Add a special desktop RPC command for the smoke.** Rejected because a test-only command would expand the product protocol and could be confused with the model-facing terminal capability.

**Require the full GUI terminal workflow in every script test.** Rejected because GUI interaction and native package installation require target runners; deterministic resource checks remain suitable for local and structural tests.

## Consequences

The Linux AppImage/deb and macOS app/dmg workflow smokes now exercise the target sidecar and PTY addon after packaged startup. The smoke owns no user data and removes its temporary extraction tree; the deb uninstall still runs before the temporary home is removed. A target runner is still required for evidence about the rendered terminal UI, updater installation, and minimum distribution compatibility.

## Testing

`apps/desktop/scripts/packaged-smoke.spec.mjs` pins target argument parsing, exact package resource discovery, missing-sidecar rejection, shell-native marker commands, process-tree observation, and package executable paths. The desktop release workflow invokes `--terminal-smoke` for Windows NSIS, Linux AppImage/deb, and macOS app/dmg artifacts.
