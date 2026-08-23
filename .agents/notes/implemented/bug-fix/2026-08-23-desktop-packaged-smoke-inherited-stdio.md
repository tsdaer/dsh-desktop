# Agent Note: Desktop packaged smoke supports inherited stdio

Status: implemented

English | [中文](2026-08-23-desktop-packaged-smoke-inherited-stdio.zh.md)

## Problem

The installed-package smoke runs installers and uninstallers with inherited stdio, so `spawnSync` returns `null` for captured output. The helper treated that value as a string and failed after a successful NSIS install before the packaged application could be checked.

## Decision

`apps/desktop/scripts/packaged-smoke.mjs` treats absent captured stdout as an empty string while preserving command failures and shell-free argument passing. The helper is exported so the script test can exercise the same inherited-stdio path used by installer commands.

## Testing

`apps/desktop/scripts/packaged-smoke.spec.mjs` runs a child process with `stdio: 'inherit'` and verifies that the command succeeds with an empty captured result. The Windows packaged smoke was also invoked against the retained local NSIS artifact; before this fix it reproduced the null-stdout failure.

## Consequences

Installer and uninstaller commands can inherit the runner's console without making the smoke depend on captured output. Commands that fail still report their exit status and available diagnostics, and no installer argument is passed through a shell.

## Related

The installed-package workflow and its remaining target-native evidence are recorded in the [desktop Windows installed-package smoke note](../testing/2026-08-22-desktop-windows-packaged-smoke.md) and the [desktop multi-platform implementation plan](../../proposed/feature/2026-08-22-desktop-multiplatform-support-plan.md).

## Alternatives considered

**Capture installer output in every invocation.** Rejected because NSIS and package-manager commands are intentionally run with inherited stdio, and the smoke does not need their output after a successful exit.

**Suppress installer output and return a fabricated string.** Rejected because inherited stdio keeps native runner diagnostics visible; the helper only normalizes the absence of captured output.
