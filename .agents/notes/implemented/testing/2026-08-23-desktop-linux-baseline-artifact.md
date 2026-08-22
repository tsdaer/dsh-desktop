# Agent Note: Desktop Linux baseline artifact

Status: implemented

English | [中文](2026-08-23-desktop-linux-baseline-artifact.zh.md)

## Problem

The Linux desktop release preflight reported the native build environment in workflow logs, but the release job did not retain that record as a downloadable build artifact.

## Decision

`apps/desktop/scripts/linux-baseline.mjs` accepts an optional `--output <file>` path. It writes a JSON document containing the validated Rust target, platform, glibc version, required GTK/WebKitGTK versions, and packaging-tool names, while retaining the one-line log record used by the workflow. The command creates the output parent directory and fails before writing when the target or prerequisite check is invalid.

The Linux release job writes the record to the runner temporary directory and uploads it with a versioned evidence-artifact name, even when a later Linux build step fails. This artifact identifies the environment used for the build; it does not establish compatibility with distributions older than the runner image.

## Testing

The script tests cover explicit output parsing and missing output values. The desktop workflow tests require the Linux job to pass an output path and upload the resulting evidence artifact. Existing injected-runner tests continue to pin the baseline fields and prerequisite failures.

## Consequences

Linux release evidence can be downloaded and compared across workflow runs without reconstructing ephemeral logs. The artifact is separate from installable release assets and does not change the supported-platform or minimum-distribution claim.

## Alternatives considered

**Keep the record only in workflow logs.** Rejected because logs are less convenient to compare and are not part of the named build evidence inventory.

**Add the JSON to the public installer release.** Rejected because the preflight describes the build runner rather than an end-user package and should not enlarge the supported download set.
