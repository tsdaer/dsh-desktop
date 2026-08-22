# Agent Note: Desktop Linux baseline preflight

Status: implemented

English | [中文](2026-08-22-desktop-linux-baseline-preflight.zh.md)

## Problem

The Linux release lane installed GTK/WebKitGTK and packaging tools, but its logs did not record the versions that the target-native bundle and packaged smokes actually used. A successful build on one runner therefore did not identify the runtime baseline represented by the artifact.

## Decision

`apps/desktop/scripts/linux-baseline.mjs` runs on the Linux x64 release runner after prerequisite installation. It records the glibc version, the `glib-2.0`, `gtk+-3.0`, and `webkit2gtk-4.1` pkg-config versions, and the availability of `pkg-config`, `dpkg-deb`, `patchelf`, and `xvfb-run`. It accepts only the explicit Linux x64 target and fails on another host, an unparseable glibc banner, a missing library, or a missing tool. The result is emitted as one JSON line so workflow logs can be retained with the build evidence.

The check records the environment used by the runner; it does not claim compatibility with older distributions. Minimum-distribution support still requires a target-native baseline smoke before Linux is listed as supported.

## Testing

Injected-command tests cover Ubuntu and GNU libc version banners, all required library/tool fields, non-Linux rejection, and missing prerequisite failure. The bundle test set runs this script test, and the CI workflow specification requires the Linux release job to invoke the preflight after installing its dependencies.

## Consequences

Linux release logs now contain the exact native library versions associated with each build. A future baseline runner can reuse the same check and compare its recorded output without changing the bundle path. The current workflow still does not by itself establish portability below the runner image it uses.

## Alternatives considered

**Rely on the runner label alone.** Rejected because a label identifies an image family, not the package versions resolved during a build.

**Declare a hard-coded minimum version in the preflight.** Rejected because the current plan has not selected a minimum Linux distribution; failing a newer or patched runner against an invented threshold would create false support policy.
