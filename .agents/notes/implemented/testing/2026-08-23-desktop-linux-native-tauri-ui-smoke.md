# Agent Note: Desktop Linux native Tauri UI smoke

Status: implemented

English | [中文](2026-08-23-desktop-linux-native-tauri-ui-smoke.zh.md)

## Problem

The Linux desktop checks exercised the installed package's readiness URL and bundled PTY runtime, while the terminal-card replay used a separate Chromium process over the assembled Web profile. Neither check drove the WebKit WebView inside the installed Tauri application.

## Decision

`apps/desktop/scripts/tauri-ui-smoke.mjs` provides an explicit Linux x64 check for a deb artifact. It installs the package with `dpkg`, starts `tauri-driver`, creates a W3C WebDriver session for the installed executable, and drives the native WebKit WebView until the composer is ready. The check materializes the committed `apps/web/tests/snapshots/navigation-panes/seed.jsonl` fixture under a temporary `DSH_HOME`, expands the sole collapsed Workspace or Ungrouped row, opens the sole persisted session row from the main session tree whether startup has already selected it or not, expands the model-facing Bash terminal card, requires `NAVIGATION_OK`, and optionally stores a WebDriver screenshot. Navigation failures report both group and session row counts and labels. A temporary home patch selects plaintext JSONL persistence only for fixture materialization; it does not alter the production bundle. The assembled Web replay retains the content-index search check because its fixture is seeded through the backend API that owns index reconciliation.

The smoke resolves the installed executable from the package manager's registered file inventory through the same bounded command runner as the deb package smoke. It purges the installed package and requires a user-owned marker in `DSH_HOME` to remain. The Linux release job installs `webkit2gtk-driver`, builds `tauri-driver`, runs the smoke under `xvfb-run`, and uploads its screenshot as a separate evidence artifact. The command is target-gated and does not run for Windows or macOS.

This check proves native WebKit WebView DOM interaction and the packaged model-facing terminal presentation using a keyless transcript. It does not prove live model traffic, compatibility with an older Linux distribution, updater installation, or the complete manual GUI checklist.

## Alternatives considered

**Treat the Chromium packaged web smoke as native WebView evidence.** Rejected because Chromium is a separate browser process and does not exercise the WebKit WebView embedded by Tauri.

**Drive a live model during release packaging.** Rejected because a committed keyless transcript keeps release evidence reproducible and avoids placing an API credential in the package workflow.

**Use a plaintext fixture in the production configuration.** Rejected because the production runtime keeps its configured compression; the smoke writes a temporary home-level override and removes the home after the check.

## Consequences

Linux release evidence now includes a screenshot and DOM assertions from the installed Tauri WebView, covering the composer, seeded session navigation, and terminal card. The native driver is an additional Linux prerequisite and the check remains evidence-only; Linux stays unsupported until the plan's update, minimum-baseline, uninstall, and packaged GUI requirements are satisfied.

## Testing

`apps/desktop/scripts/tauri-ui-smoke.spec.mjs` pins Linux target parsing, fixture path materialization, safe session paths, WebDriver capabilities, and the collapsed-group-to-session navigation sequence. `apps/desktop/scripts/run-command.spec.mjs` pins captured package inventories larger than Node's default synchronous child-process buffer. `scripts/desktop-release-workflow.spec.ts` requires the WebKit driver, `tauri-driver`, native smoke invocation, and screenshot upload. The actual installed package and WebKit execution remain target-runner evidence.
