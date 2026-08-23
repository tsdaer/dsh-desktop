# Agent Note: Desktop release jobs use the validated commit

Status: implemented

English | [中文](2026-08-23-desktop-release-uses-validated-commit.zh.md)

## Problem

The desktop release workflow validates the version tag once, but a later job that checks out the tag can read a different commit if the tag moves after validation. That would let an artifact, updater manifest, or release note come from source other than the commit recorded for the release.

## Decision

Every desktop release job that reads the source tree checks out `needs.validate.outputs.commit` and verifies that `git rev-parse HEAD` matches the same value. The draft and signed-macOS attachment jobs use the validated commit as well, so their inventory and metadata are assembled from the same source snapshot as the target-native builds.

## Testing

`scripts/desktop-release-workflow.spec.ts` checks the checkout ref and commit verification for every source-reading release job. The test continues to require target-native jobs, artifact staging, updater generation, and draft-only publication.

## Consequences

The release workflow has one source snapshot from validation through artifact publication. A moved or incorrectly resolved tag fails the job before a target build or draft refresh can use it. Workflow-dispatch runs still fail validation because the release entry point is tag-gated.

## Alternatives considered

**Keep checking out the validated tag.** Rejected because tag names are mutable references and do not carry the validated commit identity into later jobs.

**Trust the checkout ref without an explicit check.** Rejected because the job would not prove that the runner actually resolved the intended commit, and a future checkout change could silently weaken the release invariant.
