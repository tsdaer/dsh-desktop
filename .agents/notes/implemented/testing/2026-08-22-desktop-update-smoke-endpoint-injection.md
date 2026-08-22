# Agent Note: Desktop update-smoke endpoint injection

Status: implemented

English | [中文](2026-08-22-desktop-update-smoke-endpoint-injection.zh.md)

## Problem

The manifest generator can prepare signed update fixtures at a local URL, but a packaged application normally reads the production GitHub endpoint from its Tauri configuration. A target-native update smoke therefore needs an explicit way to build an application whose updater reads the controlled fixture endpoint.

## Decision

`apps/desktop/scripts/tauri-config.mjs` validates an explicit HTTP(S) updater endpoint and represents it as a later Tauri configuration layer. `bundle.mjs` accepts `--updater-endpoint`, writes that layer under a private temporary directory, validates the effective configuration, passes both reviewed layers to Tauri, and removes the temporary directory in `finally`. Credentials, query strings, and fragments are rejected before a build starts.

Production bundle commands do not receive the option and continue to use the GitHub endpoint in `tauri.conf.json`. The endpoint override is target-neutral, so the same smoke fixture can be used by the Windows, Linux, and macOS target runners without changing committed target layers.

## Alternatives considered

**Change `tauri.conf.json` for the smoke and restore it afterward.** Rejected because a mutable source configuration can leak into a release build after an interrupted run and makes the checked-in production endpoint depend on test ordering.

**Let the updater client read an endpoint from an environment variable.** Rejected because a packaged release would then allow runtime environment state to replace the signed application configuration and would not exercise the endpoint embedded in the tested artifact.

## Consequences

Target-native jobs can build an artifact that points at a runner-local signed update fixture while production artifacts retain the GitHub endpoint. The endpoint layer is temporary and never becomes a release resource. The installed version-N to version-N+1 download, confirmation, replacement, relaunch, and user-data checks still require a target-native update smoke.

## Testing

`apps/desktop/scripts/tauri-config.spec.mjs` covers endpoint validation, effective-layer merging, and the additional Tauri arguments. Existing target configuration and updater-manifest tests continue to cover bundle selection and signed fixture inventory. The local Windows environment verifies only configuration assembly; it does not provide Linux or macOS installed-update evidence.

## Related

The signed fixture URL mechanism is defined by the [controlled update-smoke manifest URL note](2026-08-22-desktop-update-smoke-manifest-base.md). The release order and support criteria are defined by the [desktop multi-platform implementation plan](../../proposed/feature/2026-08-22-desktop-multiplatform-support-plan.md).
