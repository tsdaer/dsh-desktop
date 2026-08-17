# Agent Note: Tag-Gated Desktop Release Builds

Status: implemented

English | [中文](2026-08-17-tag-gated-desktop-release-builds.zh.md)

## Problem

The desktop release workflow bundles the complete workspace, bakes a production runtime, downloads the Node sidecar, creates an NSIS installer, and checks its payload size. Running that sequence for every branch push consumes a Windows runner and produces an Actions artifact even when the push is ordinary development work. A manual rebuild from an arbitrary branch can also replace a draft Release asset with bytes that do not come from the commit named by its version tag.

## Decision

The desktop release workflow starts only for a pushed `v*` tag or `workflow_dispatch`. Both entry paths require the selected ref to be a tag whose name equals `v<apps/desktop/package.json version>`. A lightweight Windows validation job checks that package.json, Cargo.toml, and tauri.conf.json agree, that the selected tag matches that version, and that CHANGELOG.zh.md contains the corresponding section before the installer build receives a runner.

The build and draft-release jobs depend on validation and consume its version and tag outputs. A manual rebuild must therefore select the existing release tag; it cannot build a branch and overwrite an asset attached to another commit. The workflow creates a missing draft, refreshes an existing draft, and leaves a published Release unchanged. Ordinary branch pushes do not create a desktop release workflow run.

A repository test parses the workflow and pins its event filters, validation ordering, Windows PowerShell execution, version sources, Changelog check, and downstream use of validated outputs.

## Alternatives considered

**Keep every push and skip the build through a job condition.** This avoids installer work but creates a skipped workflow run for every push and leaves the expensive path reachable through future condition drift.

**Use a commit-message marker.** Markers are easy to omit, duplicate through rebases, or hide inside merge commits, and they do not identify an immutable release source.

**Use path filters on package.json or the Changelog.** A version bump can happen before release hardening, while a final release commit may change neither path. Path filters encode editing habits rather than publication intent.

**Allow manual runs from branches.** This makes rebuilding convenient but permits draft assets to diverge from the tag users inspect and later install. Selecting the tag in the manual dispatcher preserves source identity.

## Consequences

Development pushes no longer spend Windows runner time on desktop installers. A release operator must create and push the exact version tag, for example `git tag v0.3.0` followed by `git push origin v0.3.0`, or manually dispatch the workflow with that tag selected. Because the tag is the build source, any correction after tagging requires moving an unpublished tag deliberately or advancing the version; published tags remain immutable. Tag/version drift and a missing Changelog section fail before the expensive build.
