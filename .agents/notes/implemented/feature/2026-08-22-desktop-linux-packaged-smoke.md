# Agent Note: Desktop Linux packaged startup smoke

Status: implemented

English | [中文](2026-08-22-desktop-linux-packaged-smoke.zh.md)

## Problem

Linux bundle creation and artifact inventory checks do not prove that an AppImage or deb can locate its resources, start the target sidecar, reach runtime readiness, and remove the installed package without leaving a managed process behind.

## Decision

`apps/desktop/scripts/packaged-smoke.mjs` owns the Linux x64 package smoke. The AppImage is extracted and the deb is installed with `dpkg` on the target runner; both launch the packaged executable under the runner's virtual display with a temporary `DSH_HOME`. The smoke requires the shell's readiness URL, stops the detached process group, verifies that the recorded runtime descendants have exited, and checks that the temporary home still exists after deb removal. The release workflow runs both package paths after bundling and before artifact upload.

The smoke does not classify Linux as a supported release target. It proves package launch, target-resource lookup, managed-process cleanup, and deb removal; terminal interaction, updater installation, minimum-distribution coverage, and GUI evidence remain separate requirements.

## Testing

`apps/desktop/scripts/packaged-smoke.spec.mjs` pins Linux-only argument validation and descendant discovery. The script is included in the desktop bundle preparation tests. The release job supplies `xvfb-run`, runs the AppImage from its extracted package, and installs then purges the deb in the disposable runner.

## Consequences

A target-native Linux runner now fails the release job when the packaged shell cannot start its bundled runtime or when the package removal leaves the smoke process tree alive. The check uses the real package entry points but does not replace the required installed GUI, terminal, update, and baseline-distribution evidence.

## Related

The release order and remaining Linux acceptance requirements are defined by the [desktop multi-platform implementation plan](../../proposed/feature/2026-08-22-desktop-multiplatform-support-plan.md). Target selection and native runtime checks are defined by the [desktop target specification](2026-08-22-desktop-target-specification.md) and [target-native runtime validation](2026-08-22-desktop-target-native-runtime.md).

## Alternatives considered

**Launch the source CLI instead of the package.** Rejected because it bypasses Tauri resource lookup, the packaged sidecar, and the installed bundle's process lifecycle.

**Inspect package metadata without launching.** Rejected because metadata cannot prove that WebKit/Tauri startup, resource paths, or the target sidecar work together.

**Install the deb without removing it.** Rejected because the Linux release requirement includes uninstall behavior and user-data retention; the smoke must clean the disposable runner and assert that `DSH_HOME` remains.
