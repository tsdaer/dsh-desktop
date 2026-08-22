# Agent Note: Desktop packaged terminal smoke

Status: implemented

English | [中文](2026-08-22-desktop-packaged-terminal-smoke.zh.md)

## Problem

Desktop package startup can succeed while the target runtime omits or cannot load the native PTY dependency used by terminal features. A host-side terminal test does not inspect the resources staged into an AppImage, deb, or macOS app bundle.

## Decision

The Linux and macOS packaged smoke extracts or stages the artifact, launches the installed desktop executable, waits for its readiness URL, and then resolves exactly one target-named Node sidecar and one `lib/bin.js` runtime from that same package root. The sidecar runs a fixed `printf` command through the runtime's `node-pty` module, requires the marker in PTY output, waits for the probe process to exit, and retains the existing desktop process-tree cleanup check.

The deb path inspects a private `dpkg-deb --extract` tree while installing the same artifact for the application launch. The macOS dmg path copies the mounted app before launching it. Symlinks are ignored during resource discovery, and missing or duplicate sidecars and runtimes fail the smoke.

This check proves target-native packaged PTY bytes and disposal. It does not claim that a browser session invoked a model-facing terminal tool; that GUI and updater evidence remains an installed-product requirement.

## Alternatives considered

**Run the terminal command with the host Node.** Rejected because the host executable and native addons can differ from the bytes shipped in the installer.

**Add a special desktop RPC command for the smoke.** Rejected because a test-only command would expand the product protocol and could be confused with the model-facing terminal capability.

**Require the full GUI terminal workflow in every script test.** Rejected because GUI interaction and native package installation require target runners; deterministic resource checks remain suitable for local and structural tests.

## Consequences

The Linux AppImage/deb and macOS app/dmg workflow smokes now exercise the target sidecar and PTY addon after packaged startup. The smoke owns no user data and removes its temporary extraction tree; the deb uninstall still runs before the temporary home is removed. A target runner is still required for evidence about the rendered terminal UI, updater installation, and minimum distribution compatibility.

## Testing

`apps/desktop/scripts/packaged-smoke.spec.mjs` pins target argument parsing, exact package resource discovery, missing-sidecar rejection, process-tree observation, and package executable paths. The desktop release workflow invokes `--terminal-smoke` for Linux AppImage/deb and macOS app/dmg artifacts.
