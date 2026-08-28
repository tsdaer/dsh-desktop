# Agent Note: Desktop installed-package web UI smoke

Status: implemented

English | [中文](2026-08-23-desktop-installed-package-web-smoke.zh.md)

## Problem

The installed-package smoke verified readiness and a target-runtime PTY command, while the Linux release job's browser replay used the assembled source Web profile rather than the runtime delivered by an installed desktop package.

## Decision

`packaged-smoke.mjs` accepts Linux-only `--web-smoke`. While the installed package remains running, the check opens its readiness URL in Chromium, requires a successful document response, waits for the conversation composer seat and its `data-composer-input` editor to mount, validates the document title, and optionally writes a screenshot through `DSH_PACKAGED_WEB_SMOKE_SCREENSHOT`. The stable composer attributes keep this installed-package check aligned with the current Lexical editor without depending on its element type. The check closes Chromium and stops the packaged process tree before package removal.

Production runtime baking removes the workspace's development dependencies. The Linux release job restores the frozen development install before installing Chromium and running this check against the installed deb package together with the target-runtime PTY probe. Its screenshot is uploaded as evidence separate from the assembled Web replay, baseline record, and installable release assets.

This check exercises the installed package's shell, sidecar, runtime, HTTP server, and rendered Web UI through a separate Chromium process. Native Tauri WebView rendering, user-visible terminal interaction, update, minimum-distribution, and GUI evidence remain separate acceptance requirements.

## Alternatives considered

**Treat the existing assembled Web replay as installed-package evidence.** Rejected because that replay boots the source Web composition and does not prove that the installed sidecar and baked runtime serve the page.

**Attach Playwright to the native Tauri WebView.** Rejected because the target runner's WebView is not a stable remotely attachable browser endpoint; the separate browser keeps the check deterministic while preserving the native GUI evidence requirement.

**Run the check on every target immediately.** Rejected because the first new release target is Linux x64; the option is explicit and target-gated so macOS and Windows do not acquire an unverified browser-launch assumption.

## Consequences

Linux release artifacts now include a screenshot from a page served by the installed deb package, and a failed UI mount or title check fails the package smoke. The evidence strengthens packaged runtime coverage without declaring Linux supported or conflating HTTP rendering with native Tauri WebView behavior.

## Testing

`packaged-smoke.spec.mjs` covers parsing and rejects `--web-smoke` for macOS. `scripts/desktop-release-workflow.spec.ts` requires the Linux release job to restore development dependencies before installing Chromium, pass `--web-smoke`, and upload the screenshot. The target runner remains the evidence source for the actual package and browser execution.
