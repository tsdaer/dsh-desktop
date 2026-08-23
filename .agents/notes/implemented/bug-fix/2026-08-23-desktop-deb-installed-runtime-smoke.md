# Agent Note: Desktop deb installed-runtime smoke

Status: implemented

English | [中文](2026-08-23-desktop-deb-installed-runtime-smoke.zh.md)

## Problem

The Linux deb packaged smoke installed the package but resolved its executable and terminal probe from inconsistent paths, so the install check could fail before launch and the probe could inspect a temporary extraction instead of the installed runtime.

## Decision

`apps/desktop/scripts/packaged-smoke.mjs` obtains the package name before installation, queries the installed file list after `dpkg --install`, and resolves the executable, target-named sidecar, and runtime from that installed state. The POSIX path resolver is exported as a pure helper so Windows-hosted script tests can pin the Linux package layout without invoking dpkg.

The deb smoke therefore launches the executable registered by dpkg and runs the optional PTY probe against the installed resource directory. Package removal still runs in the existing cleanup path, and user-data retention remains checked separately.

## Testing

`apps/desktop/scripts/packaged-smoke.spec.mjs` covers the installed deb resource root and rejects a target sidecar outside that root. The full deb installation, launch, terminal, purge, and user-data checks remain target-native workflow evidence.

## Consequences

Linux installation evidence observes the files that the package manager installed rather than a second extracted copy. A broken package file list, missing target sidecar, or misplaced runtime now fails with a specific error before the launch check. This change does not establish minimum-distribution, updater, or GUI evidence.

## Related

The package smoke scope and remaining platform requirements are defined by the [desktop multi-platform implementation plan](../../proposed/feature/2026-08-22-desktop-multiplatform-support-plan.md). The broader Linux package checks are recorded in the [desktop Linux packaged smoke note](../feature/2026-08-22-desktop-linux-packaged-smoke.md).

## Alternatives considered

**Keep using a temporary `dpkg-deb --extract` tree for the terminal probe.** Rejected because that tree does not prove that installation placed the sidecar and runtime at the paths used by the installed executable.

**Derive the resource root from a fixed `/usr/lib` path.** Rejected because the package file listing is the package manager's authoritative installed-path record and gives a direct failure when the layout changes.
