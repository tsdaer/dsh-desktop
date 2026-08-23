# Agent Note: Desktop Linux terminal UI replay evidence

Status: implemented

English | [中文](2026-08-23-desktop-linux-terminal-ui-replay.zh.md)

## Problem

The Linux desktop release job verifies packaged startup and a target-runtime PTY command, but those checks do not exercise the assembled Web profile's model-facing terminal presentation or browser navigation.

## Decision

The Linux release job installs Chromium with the runner's system dependencies and runs `apps/web/tests/navigation-panes.e2e.ts` under `xvfb-run` with `DSH_SNAPSHOT=replay`. The committed keyless fixture drives the real assembled Web composition through its browser protocol and verifies the terminal card, trajectory details, sidebar navigation, and clipboard interaction without a model credential.

Fixture realization inserts host paths as JSON-escaped string content, and browser snapshot normalization accepts both native and escaped Windows paths, so the same replay remains valid when a Windows workspace path contains backslashes.

The Bash-specific browser assertions skip on Windows because the standard preset selects PowerShell there; the Linux release runner executes those assertions with the native Bash composition.

The job uploads the replay log and the existing failure screenshot separately from the Linux installer and baseline artifacts. The replay uses the assembled source Web profile after the workspace build; it does not claim that the installed Tauri WebView rendered the same interaction. Packaged startup, target-runtime PTY execution, installed update, minimum-distribution, and packaged GUI checks retain their separate evidence requirements.

## Alternatives considered

**Treat the packaged PTY probe as terminal UI evidence.** Rejected because it executes `node-pty` directly and does not render a model-facing tool result or browser interaction.

**Run the complete Web snapshot suite in the release job.** Rejected because the Linux desktop criterion needs one deterministic terminal/navigation scenario, while the repository's broader Web suite already has its own CI gate and would lengthen release builds without improving this evidence boundary.

**Drive a live model from the release job.** Rejected because the keyless fixture makes the terminal interaction reproducible and avoids putting an API credential into a release evidence lane.

## Consequences

Linux release logs now contain a target-runner browser replay for the model-facing terminal card and its navigation context. A passing replay closes that assembled-Web evidence gap only; it does not list Linux as supported or replace installed-package GUI, update, or minimum-distribution evidence.

## Testing

`scripts/desktop-release-workflow.spec.ts` requires Chromium installation, the replay scenario, the replay mode, and evidence upload in the Linux job. The existing `navigation-panes` fixture and Web snapshot gate validate the browser behavior; the desktop packaged-smoke tests continue to validate target-resource startup, PTY disposal, and package data retention.
