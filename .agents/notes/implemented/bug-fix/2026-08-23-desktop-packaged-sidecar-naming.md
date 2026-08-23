# Agent Note: Desktop packaged sidecar naming

Status: implemented

English | [中文](2026-08-23-desktop-packaged-sidecar-naming.zh.md)

## Problem

Tauri external binaries require target-suffixed source names such as `dsh-node-x86_64-pc-windows-msvc.exe`, but Tauri removes that suffix when it copies the binary into the application. The desktop shell and package smoke used the source basename for installed-resource discovery, so installers could build successfully while packaged startup remained on the splash because the requested Node path did not exist.

## Decision

The Tauri external-binary base is product-owned `dsh-node`, so Linux deb packages do not claim the system `/usr/bin/node` path. The desktop target specification keeps `sidecarBasename` for target-specific source staging and adds `packagedSidecarBasename` for the installed artifact. Installed Windows packages contain `dsh-node.exe`; installed Linux and macOS packages contain `dsh-node`. Sidecar acquisition and runtime baking use the source name, while the Rust shell, package resource discovery, deb file-list inspection, terminal probe, and process cleanup use the installed name or the resolved installed path.

Process cleanup matches the exact resolved sidecar path rather than every process with a similar name. Package smoke validates that exactly one installed sidecar and runtime are present before launching the shell.

## Testing

Target-specification tests pin both names for all three targets. Rust tests pin the platform-installed basename. Package-smoke tests discover the installed basename, reject missing or duplicate sidecars, and distinguish a re-parented package sidecar from unrelated or similarly prefixed Node commands.

## Consequences

Source staging remains compatible with Tauri's target-triple lookup while packaged startup follows the file layout Tauri actually emits. Any future target row must define both names explicitly, and installed-process tracking retains the resolved path to distinguish the package process from similarly named commands.

## Related

The shell's self-contained runtime requirement remains defined by [desktop cross-platform shell runtime wiring](../feature/2026-08-22-desktop-cross-platform-shell-runtime.md). Target-row ownership remains defined by [desktop target specification](../feature/2026-08-22-desktop-target-specification.md).

## Alternatives considered

**Keep target-suffixed filenames inside installed packages.** Rejected because Tauri external-binary packaging removes the target suffix; retaining it would require a different resource mechanism and duplicate launch handling.

**Use `node` as the external-binary base.** Rejected because a Linux deb would install it beside the shell as `/usr/bin/node`, colliding with the operating system's Node package.

**Match every process with a similar basename during cleanup.** Rejected because release runners execute unrelated processes and must not be terminated by the package smoke.

**Fall back to ambient Node.** Rejected because installed packages must remain self-contained and use the version baked and validated for their target.
