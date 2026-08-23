# Agent Note: Desktop installed update smoke

Status: implemented

English | [中文](2026-08-23-desktop-installed-update-smoke.zh.md)

## Problem

The target update fixture can serve a signed next-version artifact, but an installed-package check also needs to exercise the desktop updater control, application restart, managed-process cleanup, and user-data retention.

## Decision

`apps/desktop/scripts/packaged-smoke.mjs` accepts `--update-smoke --expected-version <version>` for an explicitly selected target runner. It launches the installed package with a temporary result path and the opt-in `DSH_DESKTOP_UPDATE_SMOKE=1` environment variable, requires the recorded version to transition through the installed version to the expected version, stops the restarted package process, and retains the existing user-data assertion.

The Rust shell enables the driver only when that environment variable is exactly `1`. After the main page loads, the driver clicks the existing updater button for the `available` and `ready` states and returns true from the existing confirmation calls. Each packaged launch records its compiled version at the supplied result path. Normal launches do not create the result file or change updater behavior.

The version-N package must embed the loopback endpoint supplied by `update-fixture.mjs`, and the served version-N+1 artifact must pass the existing signature checks for the same target. The smoke driver does not claim minimum-distribution compatibility or replace separate GUI evidence.

`apps/desktop/scripts/update-smoke.mjs` coordinates the fixture server and `packaged-smoke` for a fixed loopback port. It selects the installer mode from the explicit target and artifact suffix, passes arguments directly to the child process, and closes the fixture server when the smoke succeeds or fails. The version-N package is built separately with that same endpoint; the coordinator does not build or version either package.

## Alternatives considered

**Add a native updater command that installs without the page.** Rejected because it would bypass the product updater control and its confirmation path.

**Keep only the fixture server and manual confirmation.** Rejected because it leaves restart observation and managed-process cleanup to an unrepeatable manual procedure.

**Enable the driver by default in packaged builds.** Rejected because a release launch must never auto-approve an update or create a test result file.

## Consequences

Target-native jobs can run a deterministic N-to-N+1 update smoke once they have a version-N package built with the fixture endpoint and a signed version-N+1 artifact. The mechanism observes the product's existing UI state machine and confirmation calls while keeping test control opt-in. Native installation, updater replacement behavior, and GUI evidence still require execution on each supported runner.

## Testing

`apps/desktop/scripts/packaged-smoke.spec.mjs` covers the explicit update options and version validation. `apps/desktop/scripts/update-smoke.spec.mjs` covers fixed-port validation, target-specific installer selection, direct child arguments, and fixture cleanup after failure. The existing bridge updater tests continue to cover the two confirmation stages and installation failure states. Tauri Rust tests cover the existing shell contracts; target-runner execution remains required for actual updater installation and relaunch evidence.
