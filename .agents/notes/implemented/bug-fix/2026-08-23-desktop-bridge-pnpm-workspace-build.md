# Agent Note: Desktop bridge builds use pnpm workspace dependencies

Status: implemented

English | [中文](2026-08-23-desktop-bridge-pnpm-workspace-build.zh.md)

## Problem

Desktop bridge packages declare pnpm workspace dependencies, but their nested package paths were not installed as workspace projects. The bridge build attempted an npm fallback for the client package, and npm rejected `workspace:` before TypeScript could resolve React or the local UI primitives.

## Decision

`apps/desktop/bridge` and `apps/desktop/bridge-client` are pnpm workspace members. The bridge host's local dsh and Cordis dependencies use `workspace:^`, and `apps/desktop/scripts/build-bridge.mjs` only compiles the installed workspace packages; it does not invoke a second package manager. The packages remain outside the ordinary repository build globs because desktop flows explicitly build their `lib/` output before copying or baking it.

## Testing

The frozen pnpm install resolves both bridge importers and links their local dependencies. The bridge host and client builds, desktop typecheck, bridge-client test typecheck, and the six bridge-client test files pass on the Windows development host.

## Consequences

Release runners use the repository lockfile and pnpm's workspace links for bridge compilation, with no npm registry fallback or `workspace:` protocol mismatch. The bridge packages still produce independent copied artifacts for dev profiles and packaged runtimes, while their source-build dependencies are available during installation.

## Alternatives considered

**Install the nested client with npm on demand.** Rejected because npm cannot resolve the `workspace:` dependency used by the local UI primitives, and a network fallback makes a source checkout depend on a different package manager.

**Replace local dependency specs with published semver ranges.** Rejected because bridge builds must compile against the checkout's dsh and vendored Cordis sources, including versions that are not published under the old ranges.

**Add the bridge packages to the ordinary repository build globs.** Rejected because desktop packaging owns their separate host/client build and copies their package files into profiles and runtime resources.
