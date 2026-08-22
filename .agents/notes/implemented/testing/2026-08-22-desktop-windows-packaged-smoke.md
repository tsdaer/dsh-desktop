# Agent Note: Desktop Windows installed-package smoke

Status: implemented

English | [中文](2026-08-22-desktop-windows-packaged-smoke.zh.md)

## Problem

Windows release checks verified the NSIS artifact inventory but did not install the generated package before launching the shell. A packaging change could therefore pass bundle checks while breaking installation, resource lookup, runtime cleanup, or the uninstall hook.

## Decision

`apps/desktop/scripts/packaged-smoke.mjs` accepts Windows x64 NSIS artifacts with `--install-nsis`. The smoke installs the artifact into a disposable directory, launches the installed `dsh-desktop.exe`, waits for the packaged readiness URL, optionally runs the target sidecar's PTY probe, terminates the managed process tree, runs the NSIS uninstaller, and verifies that the temporary `DSH_HOME` marker remains. Windows process snapshots use PowerShell's `Win32_Process` records so a re-parented sidecar remains observable; POSIX targets retain their `ps` snapshot path.

The Windows release job runs this smoke after the size and artifact checks and before upload. It does not establish the cross-platform update, GUI, or supported-release evidence required by the multi-platform plan.

## Testing

`apps/desktop/scripts/packaged-smoke.spec.mjs` pins Windows installer argument validation and installed executable resolution. The desktop release workflow structure test requires the Windows job to invoke `--install-nsis` and `--terminal-smoke`. Native execution remains a Windows-runner check because NSIS, PowerShell process inspection, and the installed Tauri shell are not available on the current Linux/macOS paths.

## Consequences

Every Windows draft artifact is exercised through installation and uninstallation before publication staging completes. The same smoke now covers installer-owned file placement and the target-native runtime probe for all three declared desktop targets. A successful smoke still does not prove an installed N-to-N+1 updater transition or user-visible GUI flow.

## Alternatives considered

**Launch the executable from the bundle output directory.** Rejected because that bypasses NSIS file placement, uninstaller registration, and installer hooks.

**Inspect the NSIS archive without installing it.** Rejected because archive contents cannot prove that the installed executable resolves its resources or that uninstall preserves user data.

**Use a host Node process for the Windows terminal probe.** Rejected because the probe must load the sidecar and native `node-pty` bytes shipped in the installed package.
