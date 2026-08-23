# Agent Note: Desktop update workflow version argument offset

Status: implemented

English | [中文](2026-08-23-desktop-update-workflow-argv-offset.zh.md)

## Problem

The Linux, macOS, and Windows installed-update workflows compare two versions by piping JavaScript to `node -`. The stdin marker occupies `process.argv[1]`, so reading from index 1 treats `-` as the base version and leaves the real next version in the wrong position.

## Decision

All three desktop installed-update workflows read the two version arguments from `process.argv.slice(2)` and their structural tests pin that offset. A non-increasing version pair therefore fails before either update build starts, while valid version pairs reach the target-native smoke.

## Alternatives considered

**Keep the shared snippet at `slice(1)`.** Rejected because the Node stdin marker is an argument in this invocation mode and would invalidate every comparison.

**Pass a JavaScript file instead of stdin.** Rejected because the workflow only needs a short validation expression and keeping the inline check avoids another repository-owned helper.

## Consequences

The three target-native update workflows apply the same version ordering rule before building artifacts. Their tests now reject a future regression to the wrong Node stdin argument offset. The workflows remain manual, credential-dependent evidence runs and do not publish Releases.

## Testing

The Linux, macOS, and Windows workflow specs require `process.argv.slice(2)`. The existing desktop script tests and each workflow's remaining structural assertions continue to cover the invoked update coordinator and target-specific setup.
